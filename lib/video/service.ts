import "server-only";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/drizzle";
import { videoAssets as assets, videoJobs as jobs } from "@/lib/db/schema";
import { owned, withdrawVersion } from "@/lib/media/service";
import { localDevelopment } from "@/lib/media/storage";
import { HttpError } from "@/lib/moderation/http";
import {
  videoStorage,
  VIDEO_MAX,
  VIDEO_RESERVATION_BYTES,
  OWNER_MEDIA_BYTES,
} from "./storage";
const id = z.number().int().positive();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) =>
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
          v,
        ),
      "Remove control characters.",
    );
export const videoInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("reserve"),
      postId: id,
      revision: id,
      bytes: z.number().int().min(1).max(VIDEO_MAX),
      description: text(1000).pipe(z.string().min(1)),
      transcript: text(4000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      assetId: z.string().uuid(),
      token: z.string().regex(/^[a-f0-9]{64}$/),
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
      action: z.literal("describe"),
      postId: id,
      revision: id,
      assetId: z.string().uuid(),
      description: text(1000).pipe(z.string().min(1)),
      transcript: text(4000).default(""),
    })
    .strict(),
]);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const objectKey = (ext: string) => `${randomBytes(32).toString("hex")}.${ext}`;
export async function mutateVideo(
  userId: number,
  data: z.infer<typeof videoInput>,
) {
  const store =
    data.action === "reserve" || data.action === "complete"
      ? videoStorage()
      : null;
  if (data.action === "reserve") {
    const token = randomBytes(32).toString("hex"),
      assetId = randomUUID();
    const asset = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(74103,${userId}::int)`);
      const post = await owned(tx, userId, data.postId);
      if (post.revision !== data.revision)
        throw new HttpError(409, "This post changed. Reload before uploading.");
      const occupied = await tx.execute(
        sql`select id from media_assets where post_id=${post.id} and deleted_at is null union all select id from video_assets where post_id=${post.id} and deleted_at is null`,
      );
      if (occupied.length)
        throw new HttpError(
          409,
          "A post supports photos or one video. Remove existing media before replacing it.",
        );
      const [quota] = await tx.execute<{ count: number; bytes: string }>(
        sql`select count(*)::int as count,coalesce(sum(storage_bytes),0)::bigint as bytes from video_assets where owner_id=${userId} and state<>'purged'`,
      );
      const [photos] = await tx.execute<{ bytes: string }>(
        sql`select coalesce(sum(storage_bytes),0)::bigint as bytes from media_assets where owner_id=${userId} and state<>'purged'`,
      );
      if (
        quota.count >= 10 ||
        Number(quota.bytes) + Number(photos.bytes) + VIDEO_RESERVATION_BYTES >
          OWNER_MEDIA_BYTES
      )
        throw new HttpError(
          409,
          "Your video quota is full (10 retained videos / 2 GiB combined media reservations).",
        );
      const [row] = await tx
        .insert(assets)
        .values({
          id: assetId,
          ownerId: userId,
          postId: post.id,
          description: data.description,
          transcript: data.transcript,
          sourceKey: objectKey("bin"),
          playbackKey: objectKey("mp4"),
          posterKey: objectKey("webp"),
          storageDriver: store!.driver,
          uploadTokenHash: hash(token),
          uploadExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          expectedBytes: data.bytes,
        })
        .returning();
      await withdrawVersion(tx, userId, post, "video");
      return row;
    });
    try {
      const result = await db.transaction(async (tx) => {
        await owned(tx, userId, asset.postId);
        const [current] = await tx
          .select()
          .from(assets)
          .where(eq(assets.id, asset.id))
          .for("update");
        if (
          current.deletedAt ||
          current.state !== "authorizing" ||
          current.uploadExpiresAt.getTime() <= Date.now()
        )
          throw new HttpError(409, "Upload reservation changed.");
        const uploadId = await store!.initiate(current.sourceKey);
        await tx
          .update(assets)
          .set({ uploadId, state: "reserved", updatedAt: new Date() })
          .where(eq(assets.id, asset.id));
        const uploadUrl =
          store!.driver === "local"
            ? `/api/videos/${asset.id}/upload`
            : await store!.authorize(
                asset.sourceKey,
                uploadId,
                asset.expectedBytes,
                Math.max(
                  1,
                  Math.floor(
                    (asset.uploadExpiresAt.getTime() - Date.now()) / 1000,
                  ),
                ),
              );
        return { uploadUrl, local: store!.driver === "local" };
      });
      return {
        message:
          "Private video upload reserved for 15 minutes. Uploading never publishes a post.",
        id: asset.id,
        token,
        expiresAt: asset.uploadExpiresAt.toISOString(),
        ...result,
      };
    } catch (error) {
      await db
        .update(assets)
        .set({
          state: "failed",
          error: "Video upload authorization failed. Remove it and retry.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assets.id, asset.id),
            isNull(assets.deletedAt),
            eq(assets.state, "authorizing"),
          ),
        );
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "Video storage authorization is unavailable. Remove this slot and retry.",
      );
    }
  }
  if (data.action === "complete") {
    return db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, data.assetId),
            eq(assets.ownerId, userId),
            isNull(assets.deletedAt),
          ),
        );
      if (!found) throw new HttpError(404, "Your video upload was not found.");
      const post = await owned(tx, userId, found.postId);
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, found.id))
        .for("update");
      if (
        post.status !== "draft" ||
        asset.deletedAt ||
        asset.uploadTokenHash !== hash(data.token) ||
        asset.uploadExpiresAt.getTime() <= Date.now() ||
        !["reserved", "uploaded"].includes(asset.state) ||
        asset.storageDriver !== store!.driver
      )
        throw new HttpError(
          409,
          "Upload expired, changed or was already completed. Remove it to reserve a new upload.",
        );
      if (store!.driver === "local" && asset.state !== "uploaded")
        throw new HttpError(409, "Finish the local video upload first.");
      const bytes = await store!.complete(
        asset.sourceKey,
        asset.uploadId,
        asset.expectedBytes,
      );
      if (asset.uploadExpiresAt.getTime() <= Date.now())
        throw new HttpError(
          409,
          "Video completion expired before verification finished.",
        );
      await tx
        .update(assets)
        .set({ state: "queued", sourceBytes: bytes, updatedAt: new Date() })
        .where(eq(assets.id, asset.id));
      await tx.insert(jobs).values({ id: randomUUID(), assetId: asset.id });
      return {
        message:
          "Upload received and queued for processing. It remains private.",
      };
    });
  }
  return db.transaction(async (tx) => {
    const post = await owned(tx, userId, data.postId);
    if (post.revision !== data.revision)
      throw new HttpError(
        409,
        "This post changed. Reload before editing the video.",
      );
    const [asset] = await tx
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, data.assetId),
          eq(assets.postId, post.id),
          eq(assets.ownerId, userId),
          isNull(assets.deletedAt),
        ),
      )
      .for("update");
    if (!asset) throw new HttpError(404, "Your video was not found.");
    if (data.action === "remove") {
      await tx
        .update(assets)
        .set({
          deletedAt: new Date(),
          moderation: "removed",
          approvedRevision: null,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id));
      await tx
        .update(jobs)
        .set({ state: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(jobs.assetId, asset.id),
            sql`${jobs.state} in ('queued','running')`,
          ),
        );
    } else
      await tx
        .update(assets)
        .set({
          description: data.description,
          transcript: data.transcript,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id));
    await withdrawVersion(tx, userId, post, "video");
    return {
      message: "Video updated. This version needs fresh moderation approval.",
    };
  });
}
export async function receiveLocalVideo(
  userId: number,
  id: string,
  token: string,
  request: Request,
) {
  if (!localDevelopment())
    throw new HttpError(
      404,
      "Local video uploads are disabled. Production uses direct quarantine storage.",
    );
  const store = videoStorage();
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.id, id),
          eq(assets.ownerId, userId),
          isNull(assets.deletedAt),
        ),
      );
    if (!found) throw new HttpError(404, "Your video upload was not found.");
    const post = await owned(tx, userId, found.postId);
    const [asset] = await tx
      .select()
      .from(assets)
      .where(eq(assets.id, id))
      .for("update");
    if (
      post.status !== "draft" ||
      asset.state !== "reserved" ||
      asset.deletedAt ||
      asset.uploadTokenHash !== hash(token) ||
      asset.uploadExpiresAt.getTime() <= Date.now() ||
      asset.storageDriver !== "local"
    )
      throw new HttpError(
        409,
        "This video upload expired or was already used.",
      );
    if (Number(request.headers.get("content-length")) > asset.expectedBytes)
      throw new HttpError(413, "Video exceeds its reserved size.");
    if (!request.body) throw new HttpError(400, "A video file is required.");
    await tx
      .update(assets)
      .set({ state: "uploading", updatedAt: new Date() })
      .where(eq(assets.id, id));
    try {
      const bytes = await store.localWrite(
        asset.sourceKey,
        request.body,
        asset.expectedBytes,
        AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      );
      await tx
        .update(assets)
        .set({ state: "uploaded", sourceBytes: bytes, updatedAt: new Date() })
        .where(eq(assets.id, id));
      return {
        message:
          "Private local upload received. Complete it to queue processing.",
      };
    } catch (error) {
      try {
        await store.delete(asset.sourceKey);
      } catch {}
      throw error instanceof HttpError
        ? error
        : new HttpError(
            503,
            "Local video upload failed. Remove it and reserve a new upload.",
          );
    }
  });
}
