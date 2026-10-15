import "server-only";
import { sql, eq } from "drizzle-orm";
import { opendir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db/drizzle";
import { videoAssets as assets, videoJobs as jobs } from "@/lib/db/schema";
import { videoStorage } from "./storage";
import { workRoot } from "./worker";
export async function cleanupVideos(apply = false, fixtureOwnerId?: number) {
  const store = videoStorage();
  return db.transaction(async (tx) => {
    const expired = sql`((v.state in ('authorizing','reserved','uploading','uploaded') and v.upload_expires_at<now()) or ((v.state='failed' or j.state in ('failed','cancelled')) and greatest(v.updated_at,coalesce(j.updated_at,v.updated_at))<now()-interval '1 hour') or (j.state='queued' and j.created_at<now()-interval '24 hours') or (j.state='running' and j.lease_expires_at<now()-interval '24 hours') or v.deleted_at<now()-interval '30 days' or p.deleted_at<now()-interval '30 days' or u.deleted_at<now()-interval '30 days')`;
    const rows = await tx.execute<{
      id: string;
      source_key: string;
      playback_key: string;
      poster_key: string;
      upload_id: string | null;
      full_purge: boolean;
    }>(
      sql`select v.id,v.source_key,v.playback_key,v.poster_key,v.upload_id,${expired} as full_purge from video_assets v join social_posts p on p.id=v.post_id join users u on u.id=v.owner_id left join video_jobs j on j.asset_id=v.id where v.storage_driver=${store.driver} and v.state<>'purged' and ${fixtureOwnerId ? sql`v.owner_id=${fixtureOwnerId}` : sql`true`} and (${expired} or (v.state='ready' and j.state='succeeded' and v.source_deleted_at is null)) order by v.created_at limit 25 for update of v skip locked`,
    );
    let purged = 0,
      sourcesRemoved = 0;
    if (apply)
      for (const row of rows) {
        if (row.full_purge) {
          await tx
            .update(jobs)
            .set({
              state: "cancelled",
              leaseExpiresAt: null,
              updatedAt: new Date(),
            })
            .where(eq(jobs.assetId, row.id));
          await store.abort(row.source_key, row.upload_id);
          await store.delete(row.source_key);
          await store.delete(row.playback_key);
          await store.delete(row.poster_key);
          await tx
            .update(assets)
            .set({
              state: "purged",
              storageBytes: 0,
              purgedAt: new Date(),
              updatedAt: new Date(),
              approvedRevision: null,
              uploadTokenHash: "",
            })
            .where(eq(assets.id, row.id));
          purged++;
        } else {
          await store.delete(row.source_key);
          await tx.execute(
            sql`update video_assets set source_deleted_at=now(),storage_bytes=playback_bytes+poster_bytes where id=${row.id}`,
          );
          sourcesRemoved++;
        }
      }
    return {
      candidates: rows.length,
      purged,
      sourcesRemoved,
      dryRun: !apply,
      morePossible: rows.length === 25,
    };
  });
}
export async function cleanupVideoWork(apply = false, fixtureOwnerId?: number) {
  if (!process.env.VIDEO_WORK_ROOT)
    return { candidates: 0, removed: 0, dryRun: !apply };
  const root = workRoot();
  let directory;
  try {
    directory = await opendir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { candidates: 0, removed: 0, dryRun: !apply };
    throw e;
  }
  let candidates = 0,
    removed = 0,
    seen = 0;
  for await (const entry of directory) {
    if (++seen > 1000 || candidates >= 50) break;
    if (
      !entry.isDirectory() ||
      !/^[a-f0-9-]{36}-[a-f0-9-]{36}$/.test(entry.name)
    )
      continue;
    const path = join(root, entry.name);
    if ((await stat(path)).mtimeMs > Date.now() - 30 * 60 * 1000) continue;
    const id = entry.name.slice(0, 36),
      token = entry.name.slice(37);
    const rows = await db.execute<{ live: boolean }>(
      sql`select (j.state='running' and j.lease_token=${token}::uuid and j.lease_expires_at>now()) as live from video_jobs j join video_assets v on v.id=j.asset_id where j.id=${id}::uuid and ${fixtureOwnerId ? sql`v.owner_id=${fixtureOwnerId}` : sql`true`}`,
    );
    if ((fixtureOwnerId && !rows.length) || rows[0]?.live) continue;
    candidates++;
    if (apply) {
      await rm(path, { recursive: true, force: true });
      removed++;
    }
  }
  return { candidates, removed, dryRun: !apply };
}
