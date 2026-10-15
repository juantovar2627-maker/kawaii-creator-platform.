import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { HttpError } from "@/lib/moderation/http";
import { memberActive, noBlock, postVisible } from "./access";
import type {
  OwnPost,
  PublicComment,
  PublicPost,
  SocialCreator,
} from "./types";
const pageResult = <T>(items: T[], page: number, size = 10) => ({
  items: items.slice(0, size),
  page,
  hasMore: items.length > size,
});
const creatorJson = sql`json_build_object('username',cp.username,'displayName',cp.display_name,'theme',cp.theme,'avatar',cp.avatar)`;
function postJson(viewer: number | null) {
  return sql`json_build_object('id',p.id,'title',p.title,'body',p.body,'publishedAt',p.published_at at time zone 'UTC','creator',${creatorJson},'mine',coalesce(cp.user_id=${viewer},false),
 'liked',exists(select 1 from post_likes l where l.post_id=p.id and l.user_id=${viewer}),
 'saved',exists(select 1 from saved_posts s where s.post_id=p.id and s.user_id=${viewer}),
 'likes',(select count(*)::int from post_likes l where l.post_id=p.id and ${memberActive(sql`l.user_id`)} and ${noBlock(sql`l.user_id`, sql`cp.user_id`)}),
 'comments',(select count(*)::int from social_comments c where c.post_id=p.id and c.status='visible' and c.deleted_at is null and ${memberActive(sql`c.author_id`)} and ${noBlock(viewer, sql`c.author_id`)}))`;
}
export async function getFeed(
  viewer: number | null,
  scope: string,
  page: number,
  username?: string,
  id?: number,
) {
  if (["saved", "following"].includes(scope) && !viewer)
    throw new HttpError(401, "Sign in to view your collection.");
  const size = scope === "home" ? 3 : 10;
  const scopeFilter =
    scope === "saved"
      ? sql`exists(select 1 from saved_posts s where s.post_id=p.id and s.user_id=${viewer})`
      : scope === "following"
        ? sql`exists(select 1 from creator_follows f where f.creator_id=cp.user_id and f.follower_id=${viewer})`
        : scope === "creator"
          ? sql`cp.username=${username || ""}`
          : sql`cp.visibility='listed'`;
  const rows = await db.execute<{ item: PublicPost }>(
    sql`select ${postJson(viewer)} as item from social_posts p join creator_profiles cp on cp.id=p.profile_id join users u on u.id=cp.user_id where ${postVisible(viewer)} and ${id ? sql`p.id=${id}` : scopeFilter} order by p.published_at desc,p.id desc limit ${size + 1} offset ${(page - 1) * size}`,
  );
  return pageResult(
    rows.map((row) => row.item),
    page,
    size,
  );
}
export async function publicPost(id: number, viewer: number | null) {
  const result = await getFeed(viewer, "main", 1, undefined, id);
  if (!result.items[0]) throw new HttpError(404, "Public post not found.");
  return result.items[0];
}
export async function getComments(
  id: number,
  viewer: number | null,
  page: number,
) {
  await publicPost(id, viewer);
  const rows = await db.execute<{
    item: PublicComment;
  }>(sql`select json_build_object('id',c.id,'body',c.body,'createdAt',c.created_at at time zone 'UTC','updatedAt',c.updated_at at time zone 'UTC','revision',c.revision,'mine',coalesce(c.author_id=${viewer},false),
 'author',case when ap.visibility<>'hidden' and ap.moderation_status<>'suspended' then json_build_object('username',ap.username,'displayName',ap.display_name,'theme',ap.theme,'avatar',ap.avatar) else null end) as item
 from social_comments c join social_posts p on p.id=c.post_id join creator_profiles cp on cp.id=p.profile_id join users u on u.id=cp.user_id join users cu on cu.id=c.author_id left join creator_profiles ap on ap.user_id=c.author_id where c.post_id=${id} and ${postVisible(viewer)} and c.status='visible' and c.deleted_at is null and ${memberActive(sql`c.author_id`)} and ${noBlock(viewer, sql`c.author_id`)} order by c.id desc limit 11 offset ${(page - 1) * 10}`);
  return pageResult(
    rows.map((row) => row.item),
    page,
  );
}
export async function creatorSocial(username: string, viewer: number | null) {
  const [row] = await db.execute<{
    creator: SocialCreator;
    followers: number;
    following: boolean;
    mine: boolean;
  }>(sql`select ${creatorJson} as creator,
 (select count(*)::int from creator_follows f where f.creator_id=cp.user_id and ${memberActive(sql`f.follower_id`)} and ${noBlock(sql`f.follower_id`, sql`cp.user_id`)}) as followers,
 exists(select 1 from creator_follows f where f.creator_id=cp.user_id and f.follower_id=${viewer}) as following,coalesce(cp.user_id=${viewer},false) as mine
 from creator_profiles cp join users u on u.id=cp.user_id where cp.username=${username} and cp.visibility<>'hidden' and cp.moderation_status<>'suspended' and u.deleted_at is null and ${noBlock(viewer, sql`cp.user_id`)}`);
  if (!row) throw new HttpError(404, "Public creator not found.");
  return row;
}
export async function followingCreators(userId: number, page: number) {
  const rows = await db.execute<{ creator: SocialCreator }>(
    sql`select ${creatorJson} as creator from creator_follows f join creator_profiles cp on cp.user_id=f.creator_id join users u on u.id=cp.user_id where f.follower_id=${userId} and cp.visibility<>'hidden' and cp.moderation_status<>'suspended' and u.deleted_at is null and ${noBlock(userId, sql`cp.user_id`)} order by f.created_at desc,cp.id desc limit 11 offset ${(page - 1) * 10}`,
  );
  return pageResult(
    rows.map((row) => row.creator),
    page,
  );
}
export async function ownPosts(userId: number, page: number) {
  const creator = await db.execute<{ username: string; eligible: boolean }>(
    sql`select cp.username,(cp.moderation_status='approved' and not cp.listing_rejected and cp.visibility<>'hidden') as eligible from creator_profiles cp where cp.user_id=${userId}`,
  );
  const posts = await db.execute<OwnPost>(
    sql`select p.id,p.title,p.body,p.status,p.revision,p.moderation_reason as "moderationReason",p.updated_at as "updatedAt",p.published_at as "publishedAt" from social_posts p join creator_profiles cp on cp.id=p.profile_id where cp.user_id=${userId} and p.deleted_at is null order by p.updated_at desc,p.id desc limit 11 offset ${(page - 1) * 10}`,
  );
  return { ...pageResult([...posts], page), creator: creator[0] || null };
}
export async function ownActivity(userId: number, page: number) {
  const offset = (page - 1) * 10;
  const [reports, decisions, appeals, comments] = await Promise.all([
    db.execute(
      sql`select id,post_id as "postId",comment_id as "commentId",reason,explanation,status,resolution,created_at as "createdAt" from social_reports where reporter_id=${userId} order by id desc limit 11 offset ${offset}`,
    ),
    db.execute(
      sql`select h.id,h.action,h.reason,h.entity_type as "entityType",h.entity_id as "entityId",h.created_at as "createdAt" from moderation_audit h where h.action in ('post_rejected','post_removed','comment_removed','post_restored','comment_restored','post_approved') and ((h.entity_type='post' and exists(select 1 from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.id=h.entity_id and cp.user_id=${userId})) or (h.entity_type='comment' and exists(select 1 from social_comments c where c.id=h.entity_id and c.author_id=${userId}))) order by h.id desc limit 11 offset ${offset}`,
    ),
    db.execute(
      sql`select id,decision_id as "decisionId",explanation,status,resolution,created_at as "createdAt" from social_appeals where user_id=${userId} order by id desc limit 11 offset ${offset}`,
    ),
    db.execute(
      sql`select id,post_id as "postId",body,status,revision,moderation_reason as "moderationReason",updated_at as "updatedAt" from social_comments where author_id=${userId} and deleted_at is null order by id desc limit 11 offset ${offset}`,
    ),
  ]);
  return {
    reports: reports.slice(0, 10),
    decisions: decisions.slice(0, 10),
    appeals: appeals.slice(0, 10),
    comments: comments.slice(0, 10),
    page,
    hasMore: [reports, decisions, appeals, comments].some(
      (rows) => rows.length > 10,
    ),
  };
}
