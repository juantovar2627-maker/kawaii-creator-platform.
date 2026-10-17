import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { safetyRateLimits as limits } from "@/lib/db/schema";
import { getUser } from "@/lib/db/queries";
import { trustedOrigin } from "@/lib/config/runtime";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter = 60,
  ) {
    super(message);
  }
}
export const privateJson = (body: unknown, status = 200, retryAfter = 60) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...(status === 429 ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
export async function safely(work: () => Promise<NextResponse>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError)
      return privateJson(
        { error: error.message },
        error.status,
        error.retryAfter,
      );
    console.error("Safety operation failed");
    return privateJson(
      { error: "We could not complete this request. Please try again." },
      500,
    );
  }
}
export async function signedIn() {
  const user = await getUser();
  if (!user) throw new HttpError(401, "Sign in to use community safety tools.");
  return user;
}
export function checkOrigin(request: NextRequest) {
  if (trustedOrigin(request.headers.get("origin"), request.headers.get("host"))) return;

  throw new HttpError(403, "This request must come from this website.");
}
export async function input<S extends z.ZodTypeAny>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(400, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 8192) {
      await reader.cancel();
      throw new HttpError(400, "Request exceeds 8 KB.");
    }
    chunks.push(part.value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Send valid JSON.");
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues[0].message);
  return result.data;
}
export async function rateLimit(
  userId: number,
  scope: string,
  maximum: number,
  seconds: number,
) {
  const expired = sql`${limits.startedAt} <= now() - ${seconds} * interval '1 second'`;
  const [row] = await db
    .insert(limits)
    .values({ userId, scope })
    .onConflictDoUpdate({
      target: [limits.userId, limits.scope],
      set: {
        attempts: sql`case when ${expired} then 1 else ${limits.attempts} + 1 end`,
        startedAt: sql`case when ${expired} then now() else ${limits.startedAt} end`,
      },
    })
    .returning({ attempts: limits.attempts });
  if (row.attempts > maximum)
    throw new HttpError(
      429,
      "Too many attempts. Please take a little pause and try later.",
      seconds,
    );
}
