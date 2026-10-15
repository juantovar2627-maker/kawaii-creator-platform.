import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import type { Transaction } from "@/lib/moderation/permissions";
import { HttpError } from "@/lib/moderation/http";
export type Connection = typeof db | Transaction;
// Shared predicates for every real surface. SQL aliases below are server-owned.
export const noBlock = (a: number | SQL | null, b: SQL) =>
  a === null
    ? sql`true`
    : sql`not exists(select 1 from account_blocks ab where (ab.blocker_id=${a} and ab.blocked_id=${b}) or (ab.blocked_id=${a} and ab.blocker_id=${b}))`;
export const memberActive = (id: number | SQL) =>
  sql`exists(select 1 from users mu where mu.id=${id} and mu.deleted_at is null) and not exists(select 1 from creator_profiles ms where ms.user_id=${id} and ms.moderation_status='suspended')`;
export const creatorEligible = sql`u.deleted_at is null and cp.visibility <> 'hidden' and cp.moderation_status='approved' and not cp.listing_rejected`;
export const postVisible = (viewer: number | null) =>
  sql`p.status='published' and p.deleted_at is null and ${creatorEligible} and ${noBlock(viewer, sql`cp.user_id`)}`;
export async function assertActive(userId: number, tx: Connection = db) {
  const rows = await tx.execute(
    sql`select id from users where id=${userId} and ${memberActive(userId)} for share`,
  );
  if (!rows.length)
    throw new HttpError(
      403,
      "This account cannot use social interactions while suspended. Safety tools and review requests remain available.",
    );
}
// Serialize social interactions and block creation on the same account pair.
// Shared locks on both user rows coordinate with soft deletion; the advisory
// lock coordinates follow/comment actions with block/unblock transactions.
export async function lockPair(tx: Transaction, a: number, b: number) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(least(${a}::int,${b}::int),greatest(${a}::int,${b}::int))`,
  );
}
export async function lockPost(
  tx: Connection,
  id: number,
  viewer: number | null,
) {
  const [row] = await tx.execute<{
    id: number;
    profile_id: number;
    user_id: number;
    title: string;
    body: string;
    revision: number;
  }>(
    sql`select p.id,p.profile_id,cp.user_id,p.title,p.body,p.revision from social_posts p join creator_profiles cp on cp.id=p.profile_id join users u on u.id=cp.user_id where p.id=${id} and ${postVisible(viewer)} for share of p,cp,u`,
  );
  if (!row) throw new HttpError(404, "Public post not found.");
  return row;
}
