import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/lib/moderation/permissions";
import { HttpError } from "@/lib/moderation/http";
import { localDevelopment } from "./storage";

export const photoJson = sql`coalesce((select json_agg(json_build_object('id',m.id,'description',m.description,'width',m.width,'height',m.height,'state',m.state,'scanStatus',m.scan_status,'error',m.error) order by m.position,m.created_at) from media_assets m where m.post_id=p.id and m.deleted_at is null),'[]'::json)`;
export async function photoSnapshot(tx: Transaction, postId: number) {
  return [
    ...(await tx.execute(
      sql`select id,description,width,height,sha256,scan_status as "scanStatus",scan_policy as "scanPolicy",state,position from media_assets where post_id=${postId} and deleted_at is null order by position,created_at`,
    )),
  ];
}
export async function reviewPhotos(
  tx: Transaction,
  postId: number,
  approve: boolean,
) {
  const photos = await photoSnapshot(tx, postId);
  if (photos.length > 5 || photos.some((p) => p.state !== "ready"))
    throw new HttpError(
      409,
      "Finish or remove all incomplete photos before submitting or approving this post.",
    );
  if (
    approve &&
    photos.some(
      (p) =>
        p.scanStatus !== "passed" &&
        !(
          p.scanStatus === "development_manual" &&
          localDevelopment() &&
          process.env.MEDIA_SCAN_MODE === "development-manual"
        ),
    )
  )
    throw new HttpError(
      409,
      "Required photo security/content scanning has not passed. Photos remain unpublished.",
    );
  return photos;
}
export async function resetPhotos(tx: Transaction, postId: number) {
  await tx.execute(
    sql`update media_assets set moderation='pending',approved_revision=null,updated_at=now() where post_id=${postId} and deleted_at is null`,
  );
}
