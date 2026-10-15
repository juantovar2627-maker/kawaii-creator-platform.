import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  creatorMutationLimits as limits,
  creatorProfiles as profiles,
} from "@/lib/db/schema";
import { getUser } from "@/lib/db/queries";
import { getOwnCreator } from "@/lib/creators/queries";
import { creatorInputSchema } from "@/lib/creators/validation";
import { audit } from "@/lib/moderation/audit";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200, headers = {}) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });

export async function GET() {
  const user = await getUser();
  if (!user)
    return reply({ error: "Sign in to manage your creator space." }, 401);
  return reply({ profile: await getOwnCreator(user.id) });
}

// Bound streamed bodies as well as Content-Length; never buffer arbitrary input.
async function readInput(request: NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("content-type");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      throw new Error("size");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function mutate(request: NextRequest, create: boolean) {
  // Cookie-authenticated JSON mutations require a same-origin browser request.
  // Next can normalize request.url's hostname internally (e.g. loopback to
  // localhost). Match the browser's Origin against the actual HTTP Host.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") || "");
    sameOrigin =
      ["http:", "https:"].includes(origin.protocol) &&
      origin.host === request.headers.get("host")?.toLowerCase();
  } catch {
    /* Missing or opaque origins cannot mutate an account. */
  }
  if (!sameOrigin) {
    return reply({ error: "This request must come from this website." }, 403);
  }
  const user = await getUser();
  if (!user)
    return reply({ error: "Sign in to manage your creator space." }, 401);

  const [limit] = await db
    .insert(limits)
    .values({ userId: user.id })
    .onConflictDoUpdate({
      target: limits.userId,
      set: {
        attempts: sql`case when ${limits.windowStartedAt} <= now() - interval '1 minute' then 1 else ${limits.attempts} + 1 end`,
        windowStartedAt: sql`case when ${limits.windowStartedAt} <= now() - interval '1 minute' then now() else ${limits.windowStartedAt} end`,
      },
    })
    .returning({ attempts: limits.attempts });
  if (limit.attempts > 20)
    return reply({ error: "A little pause. Try again in one minute." }, 429, {
      "Retry-After": "60",
    });

  let raw: unknown;
  try {
    raw = await readInput(request);
  } catch {
    return reply(
      { error: "Send a valid JSON profile smaller than 8 KB." },
      400,
    );
  }
  const parsed = creatorInputSchema.safeParse(raw);
  if (!parsed.success)
    return reply({ error: parsed.error.issues[0].message }, 400);
  const { communityAccepted, ...input } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      if (create) {
        const [created] = await tx
          .insert(profiles)
          .values({ ...input, userId: user.id })
          .returning();
        await audit(tx, {
          actorId: user.id,
          actorRole: "member",
          action: "profile_created",
          entityType: "profile",
          entityId: created.id,
          profileId: created.id,
          reason: "Creator opted into a profile.",
          snapshot: {
            username: created.username,
            visibility: created.visibility,
            revision: created.revision,
          },
        });
      } else {
        // The owner always comes from the verified session, never from input.
        // Content changes invalidate any prior discovery approval atomically.
        // Suspended profiles cannot lift their suspension through editing.
        const changed = await tx
          .update(profiles)
          .set({
            ...input,
            updatedAt: new Date(),
            moderationStatus: sql`case when ${profiles.moderationStatus} = 'suspended' then 'suspended' else 'pending' end`,
            listingRejected: false,
            moderationReason: sql`case when ${profiles.moderationStatus} = 'suspended' then ${profiles.moderationReason} else '' end`,
            revision: sql`${profiles.revision} + 1`,
          })
          .where(eq(profiles.userId, user.id))
          .returning({ id: profiles.id, revision: profiles.revision });
        if (!changed.length) return;
        await audit(tx, {
          actorId: user.id,
          actorRole: "member",
          action: "profile_edited",
          entityType: "profile",
          entityId: changed[0].id,
          profileId: changed[0].id,
          reason: "Creator edited profile; discovery approval requires review.",
          snapshot: {
            username: input.username,
            visibility: input.visibility,
            revision: changed[0].revision,
          },
        });
      }
    });
    const profile = await getOwnCreator(user.id);
    if (!profile)
      return reply({ error: "Set up your own creator profile first." }, 404);
    return reply({ profile }, create ? 201 : 200);
  } catch (error) {
    // Drizzle wraps PostgreSQL errors; inspect only the code, never echo SQL.
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure.cause?.code ?? failure.code) === "23505") {
      return reply(
        {
          error:
            "That username is taken, or your account already has a creator profile.",
        },
        409,
      );
    }
    console.error("Creator profile mutation failed");
    return reply(
      { error: "We could not save your profile. Please try again." },
      500,
    );
  }
}
export async function POST(request: NextRequest) {
  return mutate(request, true);
}
export async function PATCH(request: NextRequest) {
  return mutate(request, false);
}
