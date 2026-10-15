import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/lib/moderation/permissions";
import { HttpError } from "@/lib/moderation/http";
import { localDevelopment } from "@/lib/media/storage";
export const videoJson = sql`(select json_build_object('id',v.id,'description',v.description,'transcript',v.transcript,'state',case when j.state='failed' and v.state<>'ready' then 'failed' when j.state='running' then 'processing' else v.state end,'scanStatus',v.scan_status,'width',v.width,'height',v.height,'durationMs',v.duration_ms,'error',coalesce(v.error,case when j.state='failed' then 'Video processing failed after the allowed attempts. Remove it and retry.' else null end)) from video_assets v left join video_jobs j on j.asset_id=v.id where v.post_id=p.id and v.deleted_at is null limit 1)`;
export async function videoSnapshot(tx: Transaction, postId: number) {
  return (
    [
      ...(await tx.execute(
        sql`select v.id,v.description,v.transcript,v.state,v.width,v.height,v.duration_ms as "durationMs",v.sha256,v.scan_status as "scanStatus",v.scan_policy as "scanPolicy",v.processor_mode as "processorMode",j.state as "jobState" from video_assets v left join video_jobs j on j.asset_id=v.id where v.post_id=${postId} and v.deleted_at is null limit 1`,
      )),
    ][0] ?? null
  );
}
export async function reviewVideos(
  tx: Transaction,
  postId: number,
  approve: boolean,
) {
  const video = await videoSnapshot(tx, postId);
  if (!video) return;
  const photos = await tx.execute(
    sql`select id from media_assets where post_id=${postId} and deleted_at is null limit 1`,
  );
  if (
    photos.length ||
    video.state !== "ready" ||
    video.jobState !== "succeeded"
  )
    throw new HttpError(
      409,
      "Finish processing the video before submitting. Photo and video posts cannot be mixed.",
    );
  if (
    approve &&
    !(video.scanStatus === "passed" && video.processorMode === "bwrap") &&
    !(
      video.scanStatus === "development_manual" &&
      localDevelopment() &&
      process.env.MEDIA_SCAN_MODE === "development-manual"
    )
  )
    throw new HttpError(
      409,
      "Required video scanning and isolated processing have not passed. The video remains unpublished.",
    );
}
export async function resetVideos(tx: Transaction, postId: number) {
  await tx.execute(
    sql`update video_assets set moderation='pending',approved_revision=null,updated_at=now() where post_id=${postId} and deleted_at is null`,
  );
}
