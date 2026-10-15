import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { mediaAssets } from "@/lib/db/schema";
import { storage } from "./storage";
import { eq } from "drizzle-orm";

// Scheduled trusted-operator job. Small batches, SKIP LOCKED, and idempotent
// object deletion permit concurrent jobs and safe retries after interruption.
export async function cleanupMedia(apply = false, fixtureOwnerId?: number) {
  const store = storage();
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      display_key: string;
      thumbnail_key: string;
    }>(sql`
      select m.id,m.display_key,m.thumbnail_key from media_assets m join social_posts p on p.id=m.post_id join users u on u.id=m.owner_id
      where m.storage_driver=${store.driver} and ${fixtureOwnerId ? sql`m.owner_id=${fixtureOwnerId}` : sql`true`} and m.state<>'purged' and (
        (m.state in ('reserved','processing') and m.upload_expires_at<now()) or
        (m.state='failed' and m.updated_at<now()-interval '1 hour') or
        m.deleted_at<now()-interval '30 days' or p.deleted_at<now()-interval '30 days' or u.deleted_at<now()-interval '30 days'
      ) order by m.created_at limit 50 for update of m skip locked`);
    let purged = 0;
    if (apply)
      for (const row of rows) {
        await store.delete(row.display_key);
        await store.delete(row.thumbnail_key);
        await tx
          .update(mediaAssets)
          .set({
            state: "purged",
            storageBytes: 0,
            purgedAt: new Date(),
            updatedAt: new Date(),
            uploadTokenHash: "",
            approvedRevision: null,
          })
          .where(eq(mediaAssets.id, row.id));
        purged++;
      }
    return {
      candidates: rows.length,
      purged,
      morePossible: rows.length === 50,
      dryRun: !apply,
    };
  });
}
