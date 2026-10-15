import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  videoAssets as assets,
  videoJobs as jobs,
  videoWorkers as workers,
} from "@/lib/db/schema";
import { owned } from "@/lib/media/service";
import { HttpError } from "@/lib/moderation/http";
import { videoStorage, VIDEO_MAX } from "./storage";
import { processVideo, VideoError } from "./process";
import { scanVideo } from "./scan";
export function workRoot() {
  const root = process.env.VIDEO_WORK_ROOT;
  if (
    !root ||
    !isAbsolute(root) ||
    resolve(root) === process.cwd() ||
    resolve(root).startsWith(process.cwd() + "/")
  )
    throw new VideoError("private_video_work_root_required", false);
  return root;
}
export async function runWorkerOnce(
  workerId = randomUUID(),
  outerSignal: AbortSignal = new AbortController().signal,
) {
  await db
    .insert(workers)
    .values({ id: workerId, status: "idle" })
    .onConflictDoUpdate({
      target: workers.id,
      set: { status: "idle", heartbeatAt: new Date(), currentJobId: null },
    });
  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(74105,0)`);
    await tx.execute(
      sql`update video_jobs set state='failed',error='Worker lease expired after maximum attempts',updated_at=now() where state='running' and lease_expires_at<now() and attempts>=3`,
    );
    const [load] = await tx.execute<{ count: number }>(
      sql`select count(*)::int as count from video_jobs where state='running' and lease_expires_at>now()`,
    );
    if (load.count >= 2) return null;
    const [row] = await tx.execute<{ id: string; asset_id: string }>(
      sql`select j.id,j.asset_id from video_jobs j join video_assets v on v.id=j.asset_id join social_posts p on p.id=v.post_id join creator_profiles cp on cp.id=p.profile_id join users u on u.id=v.owner_id where ((j.state='queued' and j.available_at<=now()) or (j.state='running' and j.lease_expires_at<now())) and j.attempts<3 and v.deleted_at is null and v.state<>'purged' and p.deleted_at is null and u.deleted_at is null and cp.moderation_status<>'suspended' order by j.available_at,j.created_at limit 1 for update of j skip locked`,
    );
    if (!row) return null;
    const token = randomUUID();
    const [job] = await tx
      .update(jobs)
      .set({
        state: "running",
        attempts: sql`${jobs.attempts}+1`,
        workerId,
        leaseToken: token,
        leaseExpiresAt: sql`now()+interval '90 seconds'`,
        updatedAt: new Date(),
        error: null,
      })
      .where(eq(jobs.id, row.id))
      .returning();
    return job;
  });
  if (!claim) {
    await db
      .update(workers)
      .set({ status: "idle", heartbeatAt: new Date() })
      .where(eq(workers.id, workerId));
    return { workerId, jobId: null, state: "idle" };
  }
  await db
    .update(workers)
    .set({ status: "busy", currentJobId: claim.id, heartbeatAt: new Date() })
    .where(eq(workers.id, workerId));
  const controller = new AbortController(),
    signal = AbortSignal.any([
      outerSignal,
      controller.signal,
      AbortSignal.timeout(420000),
    ]);
  let pending: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    if (pending) return;
    pending = (async () => {
      try {
        const result = await db.execute(
          sql`update video_jobs set lease_expires_at=now()+interval '90 seconds',updated_at=now() where id=${claim.id} and lease_token=${claim.leaseToken} and state='running' returning id`,
        );
        if (!result.length) controller.abort();
        await db
          .update(workers)
          .set({ heartbeatAt: new Date() })
          .where(eq(workers.id, workerId));
      } catch {
        controller.abort();
      } finally {
        pending = null;
      }
    })();
  }, 15000);
  const stopHeartbeat = async () => {
    clearInterval(heartbeat);
    if (pending) await pending;
  };
  let directory: string | undefined;
  try {
    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, claim.assetId));
    const store = videoStorage();
    if (store.driver !== asset.storageDriver)
      throw new VideoError("video_storage_driver_unavailable", false);
    await db.transaction(async (tx) => {
      const post = await owned(tx, asset.ownerId, asset.postId);
      if (post.status !== "draft") throw new VideoError("post_not_editable");
      const [current] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, asset.id))
        .for("update");
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, claim.id))
        .for("update");
      if (
        current.deletedAt ||
        job.state !== "running" ||
        job.leaseToken !== claim.leaseToken
      )
        throw new VideoError("job_cancelled");
      await tx
        .update(assets)
        .set({ state: "processing", error: null, updatedAt: new Date() })
        .where(eq(assets.id, asset.id));
    });
    const root = workRoot();
    await mkdir(root, { recursive: true, mode: 0o700 });
    directory = join(root, `${claim.id}-${claim.leaseToken}`);
    await mkdir(directory, { mode: 0o700 });
    const size = await store.head(asset.sourceKey);
    if (size !== asset.expectedBytes || size > VIDEO_MAX)
      throw new VideoError("verified_upload_size_changed");
    const bytes = await store.download(
      asset.sourceKey,
      join(directory, "source.bin"),
      VIDEO_MAX,
      AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    );
    if (bytes !== asset.expectedBytes)
      throw new VideoError("incomplete_quarantine_object");
    const result = await processVideo(directory, signal);
    const scan = await scanVideo(
      result.playback,
      result.playbackBytes,
      result.sha256,
      Boolean(result.audioCodec),
      signal,
    );
    if (scan === "rejected") throw new VideoError("scan_rejected");
    if (scan === "unavailable") throw new VideoError("scan_unavailable", false);
    await stopHeartbeat();
    await db.transaction(async (tx) => {
      const post = await owned(tx, asset.ownerId, asset.postId);
      const [current] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, asset.id))
        .for("update");
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, claim.id))
        .for("update");
      if (
        post.status !== "draft" ||
        current.deletedAt ||
        job.state !== "running" ||
        job.leaseToken !== claim.leaseToken ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt.getTime() <= Date.now() ||
        signal.aborted
      )
        throw new VideoError("job_lease_lost", false);
      // Storage writes remain under the asset/job locks. A crash rolls the job
      // back to leased processing; recovery never loses the recorded object keys.
      await store.putFile(asset.playbackKey, result.playback, "video/mp4");
      await store.putFile(asset.posterKey, result.poster, "image/webp");
      await tx
        .update(assets)
        .set({
          state: "ready",
          scanStatus: scan,
          scanPolicy:
            scan === "passed"
              ? "mimi-video-non-explicit-v1"
              : "Unscanned local development fixture; manual review required",
          processorMode: result.processorMode,
          width: result.width,
          height: result.height,
          durationMs: result.durationMs,
          frameRate: result.frameRate,
          videoCodec: result.videoCodec,
          audioCodec: result.audioCodec,
          sourceSha256: result.sourceSha256,
          sha256: result.sha256,
          playbackBytes: result.playbackBytes,
          posterBytes: result.posterBytes,
          storageBytes:
            result.playbackBytes + result.posterBytes + asset.sourceBytes,
          sourceDeletedAt: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id));
      await tx
        .update(jobs)
        .set({
          state: "succeeded",
          leaseExpiresAt: null,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
    });
    // Originals are removed only after the ready/job-success commit. A crash
    // before commit must retain input so the next lease can actually retry.
    try {
      await store.delete(asset.sourceKey);
      await db.execute(
        sql`update video_assets set source_deleted_at=now(),storage_bytes=playback_bytes+poster_bytes where id=${asset.id} and state='ready' and source_deleted_at is null`,
      );
    } catch {
      /* Cleanup retries private source deletion. */
    }
    return {
      workerId,
      jobId: claim.id,
      assetId: claim.assetId,
      state: "succeeded",
    };
  } catch (error) {
    await stopHeartbeat();
    const reason =
      error instanceof VideoError
        ? error
        : new VideoError(
            error instanceof HttpError
              ? "post_unavailable"
              : "worker_or_storage_unavailable",
            error instanceof HttpError,
          );
    let outcome = "cancelled";
    await db.transaction(async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, claim.assetId))
        .for("update");
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, claim.id))
        .for("update");
      if (
        !asset ||
        !job ||
        job.state !== "running" ||
        job.leaseToken !== claim.leaseToken
      )
        return;
      const retry = !reason.permanent && job.attempts < 3 && !asset.deletedAt;
      outcome = retry ? "queued" : "failed";
      await tx
        .update(jobs)
        .set({
          state: outcome,
          availableAt: new Date(Date.now() + job.attempts * 30000),
          leaseExpiresAt: null,
          error: reason.code,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      await tx
        .update(assets)
        .set({
          state: retry ? "queued" : "failed",
          scanStatus:
            reason.code === "scan_rejected"
              ? "rejected"
              : reason.code === "scan_unavailable"
                ? "unavailable"
                : asset.scanStatus,
          error: retry
            ? "Processing could not finish. A limited retry is scheduled."
            : "Video could not be processed. Check the supported limits, remove it and try again.",
          updatedAt: new Date(),
        })
        .where(eq(assets.id, asset.id));
    });
    return {
      workerId,
      jobId: claim.id,
      assetId: claim.assetId,
      state: outcome,
      code: reason.code,
    };
  } finally {
    clearInterval(heartbeat);
    if (directory)
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        console.error("Video temporary cleanup requires retry");
      }
    await db
      .update(workers)
      .set({ status: "idle", currentJobId: null, heartbeatAt: new Date() })
      .where(eq(workers.id, workerId));
  }
}
