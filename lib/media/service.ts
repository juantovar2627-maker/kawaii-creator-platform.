import "server-only";
import { uploadsEnabled } from "@/lib/config/runtime";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/drizzle";
import {
  mediaAssets as assets,
  socialPosts as posts,
  creatorProfiles as profiles,
} from "@/lib/db/schema";
import { assertActive } from "@/lib/social/access";
import { HttpError } from "@/lib/moderation/http";
import type { Transaction } from "@/lib/moderation/permissions";
import { audit } from "@/lib/moderation/audit";
import { resetPhotos } from "./lifecycle";
import { storage } from "./storage";
import { MAX_BYTES, processPhoto, scanPhoto } from "./process";

const id = z.number().int().positive();
const description = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (v) => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(v),
    "Remove control characters.",
  );
export const mediaInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("reserve"),
      postId: id,
      revision: id,
      description,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      postId: id,
      revision: id,
      assetId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("arrange"),
      postId: id,
      revision: id,
      photos: z
        .array(z.object({ id: z.string().uuid(), description }).strict())
        .min(1)
        .max(5),
    })
    .strict(),
]);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function owned(
  tx: Transaction,
  userId: number,
  postId: number,
  editable = true,
) {
  await assertActive(userId, tx);
  const [profile] = await tx
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .for("share");
  if (!profile || profile.moderationStatus === "suspended")
    throw new HttpError(403, "An active creator profile is required.");
  const [post] = await tx
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.profileId, profile.id),
        isNull(posts.deletedAt),
      ),
    )
    .for("update");
  if (!post) throw new HttpError(404, "Your post was not found.");
  if (editable && post.status === "removed")
    throw new HttpError(
      403,
      "Removed posts require a review request; their photos cannot be changed.",
    );
  return post;
}
export async function withdrawVersion(
  tx: Transaction,
  userId: number,
  post: typeof posts.$inferSelect,
  kind: "photos" | "video" = "photos",
) {
  await tx
    .update(posts)
    .set({
      status: "draft",
      revision: post.revision + 1,
      publishedAt: null,
      moderationReason: "",
      updatedAt: new Date(),
    })
    .where(eq(posts.id, post.id));
  await resetPhotos(tx, post.id);
  await audit(tx, {
    actorId: userId,
    actorRole: "member",
    action: kind === "video" ? "post_video_edited" : "post_photos_edited",
    entityType: "post",
    entityId: post.id,
    profileId: post.profileId,
    reason: `${kind === "video" ? "Video" : "Photo"} change withdrew the post to draft; fresh approval required.`,
    snapshot: { previousRevision: post.revision, previousStatus: post.status },
  });
}
export async function changePhotos(
  userId: number,
  data: z.infer<typeof mediaInput>,
) {
  if (data.action === "reserve" && !uploadsEnabled())
    throw new HttpError(503, "Photo uploads are disabled in this environment.");
  const store = data.action === "reserve" ? storage() : null;
  return db.transaction(async (tx) => {
    // One quota reservation per owner at a time, across all application instances.
    await tx.execute(sql`select pg_advisory_xact_lock(74103,${userId}::int)`);
    const post = await owned(tx, userId, data.postId);
    if (post.revision !== data.revision)
      throw new HttpError(
        409,
        "This post changed. Reload before editing photos.",
      );
    const current = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.postId, post.id), isNull(assets.deletedAt)));
    if (data.action === "reserve") {
      const mixed = await tx.execute(
        sql`select id from video_assets where post_id=${post.id} and deleted_at is null limit 1`,
      );
      if (mixed.length)
        throw new HttpError(
          409,
          "A post can contain photos or one video, not both.",
        );
      if (current.length >= 5)
        throw new HttpError(
          409,
          "A post can have at most five photos. Remove an incomplete photo before trying again.",
        );
      const [quota] = await tx.execute<{ count: number; bytes: number }>(
        sql`select count(*)::int as count,coalesce(sum(storage_bytes),0)::int as bytes from media_assets where owner_id=${userId} and state<>'purged'`,
      );
      const [videoQuota] = await tx.execute<{ bytes: number }>(
        sql`select coalesce(sum(storage_bytes),0)::bigint as bytes from video_assets where owner_id=${userId} and state<>'purged'`,
      );
      if (
        Number(videoQuota.bytes) + quota.bytes + MAX_BYTES >
        2 * 1024 * 1024 * 1024
      )
        throw new HttpError(409, "Your combined private-media quota is full.");
      if (quota.count >= 200 || quota.bytes + MAX_BYTES > 500 * 1024 * 1024)
        throw new HttpError(
          409,
          "Your photo quota is full (200 assets / 500 MB, including retained uploads). Contact support.",
        );
      const assetId = randomUUID(),
        token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 15 * 60 * 1000);
      await tx.insert(assets).values({
        id: assetId,
        ownerId: userId,
        postId: post.id,
        position: [0, 1, 2, 3, 4].find(
          (i) => !current.some((p) => p.position === i),
        )!,
        description: data.description,
        displayKey: `${randomBytes(32).toString("hex")}.webp`,
        thumbnailKey: `${randomBytes(32).toString("hex")}.webp`,
        storageDriver: store!.driver,
        uploadTokenHash: hash(token),
        uploadExpiresAt: expires,
      });
      await withdrawVersion(tx, userId, post);
      return {
        message:
          "Photo slot reserved for 15 minutes. Uploading does not publish it.",
        id: assetId,
        token,
        expiresAt: expires.toISOString(),
        revision: post.revision + 1,
      };
    }
    if (data.action === "remove") {
      if (!current.some((p) => p.id === data.assetId))
        throw new HttpError(404, "Your photo was not found.");
      await tx
        .update(assets)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          moderation: "removed",
          approvedRevision: null,
        })
        .where(eq(assets.id, data.assetId));
    } else {
      if (
        new Set(data.photos.map((p) => p.id)).size !== current.length ||
        data.photos.length !== current.length ||
        data.photos.some((p) => !current.some((c) => c.id === p.id))
      )
        throw new HttpError(
          400,
          "Include each of this post’s photos exactly once.",
        );
      for (const [position, photo] of data.photos.entries())
        await tx
          .update(assets)
          .set({
            position,
            description: photo.description,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, photo.id));
    }
    await withdrawVersion(tx, userId, post);
    return {
      message:
        "Photos updated. This version is a private draft until approved again.",
      revision: post.revision + 1,
    };
  });
}

export async function receivePhoto(
  userId: number,
  assetId: string,
  token: string,
  request: Request,
) {
  if (!uploadsEnabled())
    throw new HttpError(503, "Photo uploads are disabled in this environment.");
  const store = storage();
  const asset = await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, assetId),
          eq(assets.ownerId, userId),
          isNull(assets.deletedAt),
        ),
      );
    if (!found) throw new HttpError(404, "Your upload was not found.");
    const post = await owned(tx, userId, found.postId);
    if (post.status !== "draft")
      throw new HttpError(409, "Only a draft accepts photo uploads.");
    await tx.execute(sql`select pg_advisory_xact_lock(74104,0)`);
    const [slot] = await tx.execute<{ count: number }>(
      sql`select count(*)::int as count from media_assets where state='processing' and upload_expires_at>now()`,
    );
    if (slot.count >= 2)
      throw new HttpError(
        429,
        "Photo processing is busy. Try again shortly.",
        30,
      );
    const [row] = await tx
      .select()
      .from(assets)
      .where(eq(assets.id, assetId))
      .for("update");
    if (
      row.state !== "reserved" ||
      row.deletedAt ||
      row.uploadExpiresAt.getTime() <= Date.now() ||
      row.uploadTokenHash !== hash(token) ||
      row.storageDriver !== store.driver
    )
      throw new HttpError(
        409,
        "This upload authorization expired or was already used. Remove the photo slot and try again.",
      );
    await tx
      .update(assets)
      .set({ state: "processing", updatedAt: new Date() })
      .where(eq(assets.id, assetId));
    return row;
  });
  try {
    const length = Number(request.headers.get("content-length"));
    if (length > MAX_BYTES)
      throw new HttpError(413, "Photos must be at most 10 MB.");
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, "A photo is required.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void reader.cancel();
        reject(new HttpError(408, "Photo upload timed out."));
      }, 30000);
    });
    try {
      await Promise.race([
        deadline,
        (async () => {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.length;
            if (total > MAX_BYTES) {
              await reader.cancel();
              throw new HttpError(413, "Photos must be at most 10 MB.");
            }
            chunks.push(part.value);
          }
        })(),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    const photo = await processPhoto(Buffer.concat(chunks));
    const scan = await scanPhoto(photo.display, photo.thumbnail, photo.sha256);
    if (scan.status === "rejected")
      throw new HttpError(
        400,
        "The configured scanner rejected this photo. It has not been stored or published.",
      );
    await db.transaction(async (tx) => {
      const post = await owned(tx, userId, asset.postId);
      const [current] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, asset.id))
        .for("update");
      if (
        current.state !== "processing" ||
        current.deletedAt ||
        current.uploadExpiresAt.getTime() <= Date.now() ||
        post.status !== "draft"
      )
        throw new HttpError(
          409,
          "The post or upload changed while processing. Reserve a new photo slot.",
        );
      // Hold the asset lock while writing. Cleanup must not mark it purged
      // before a late write; a crash rolls this transaction back to processing
      // so the recorded keys remain eligible for cleanup.
      await store.put(asset.displayKey, photo.display);
      await store.put(asset.thumbnailKey, photo.thumbnail);
      await tx
        .update(assets)
        .set({
          state: "ready",
          scanStatus: scan.status,
          scanPolicy: scan.policy,
          width: photo.width,
          height: photo.height,
          sha256: photo.sha256,
          storageBytes: photo.display.length + photo.thumbnail.length,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id));
    });
    return {
      message:
        scan.status === "passed"
          ? "Photo processed; staff approval is still required."
          : "Photo processed but not content-scanned. Publication requires the configured scanning policy and staff approval.",
    };
  } catch (error) {
    // Failed deletions retain the quota reservation and known keys for retry by
    // cleanup; never erase the only reference to an object that may exist.
    const deleted = await Promise.allSettled([
      store.delete(asset.displayKey),
      store.delete(asset.thumbnailKey),
    ]);
    await db
      .update(assets)
      .set({
        state: "failed",
        ...(deleted.every((r) => r.status === "fulfilled")
          ? { storageBytes: 0 }
          : {}),
        error:
          error instanceof HttpError
            ? error.message.slice(0, 300)
            : "Photo processing/storage failed. Remove this slot and retry.",
        updatedAt: new Date(),
      })
      .where(and(eq(assets.id, asset.id), eq(assets.state, "processing")));
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "Photo storage or processing is unavailable. Remove this slot and try again.",
    );
  }
}
