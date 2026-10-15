import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  socialPosts as posts,
  socialComments as comments,
  socialReports as reports,
  socialAppeals as appeals,
  creatorProfiles as profiles,
} from "@/lib/db/schema";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { audit } from "@/lib/moderation/audit";
import { HttpError } from "@/lib/moderation/http";
import { creatorEligible, lockPost, memberActive, noBlock } from "./access";
import { socialAdminInput, socialAdminQuery } from "./validation";
import type { z } from "zod";

import { photoJson, photoSnapshot, reviewPhotos } from "@/lib/media/lifecycle";

import { videoJson, videoSnapshot } from "@/lib/video/lifecycle";

export async function getSocialQueue(q: z.infer<typeof socialAdminQuery>) {
  const offset = (q.page - 1) * 10;
  let items;
  if (q.kind === "posts") {
    if (
      !["all", "pending", "published", "rejected", "removed"].includes(q.status)
    )
      throw new HttpError(400, "Invalid post status.");
    items = await db.execute(
      sql`select p.id,p.title,p.body,${photoJson} as photos,${videoJson} as video,p.status,p.revision,p.moderation_reason as "moderationReason",p.updated_at as "createdAt",cp.username from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.deleted_at is null and p.status<>'draft' and ${q.status === "all" ? sql`true` : sql`p.status=${q.status}`} order by p.updated_at desc,p.id desc limit 11 offset ${offset}`,
    );
  } else if (q.kind === "comments") {
    if (!["all", "visible", "removed"].includes(q.status))
      throw new HttpError(400, "Invalid comment status.");
    items = await db.execute(
      sql`select c.id,c.post_id as "postId",c.body,c.status,c.revision,c.moderation_reason as "moderationReason",c.updated_at as "createdAt" from social_comments c where c.deleted_at is null and ${q.status === "all" ? sql`true` : sql`c.status=${q.status}`} order by c.id desc limit 11 offset ${offset}`,
    );
  } else if (q.kind === "reports") {
    if (!["all", "open", "resolved", "dismissed"].includes(q.status))
      throw new HttpError(400, "Invalid report status.");
    items = await db.execute(
      sql`select id,post_id as "postId",comment_id as "commentId",reason,explanation,snapshot,status,resolution,created_at as "createdAt" from social_reports where ${q.status === "all" ? sql`true` : sql`status=${q.status}`} order by id desc limit 11 offset ${offset}`,
    );
  } else {
    if (!["all", "open", "reviewed"].includes(q.status))
      throw new HttpError(400, "Invalid review status.");
    items = await db.execute(
      sql`select a.id,a.explanation,a.status,a.resolution,a.created_at as "createdAt",h.reason,h.entity_type as "entityType",h.entity_id as "entityId",h.snapshot from social_appeals a join moderation_audit h on h.id=a.decision_id where ${q.status === "all" ? sql`true` : sql`a.status=${q.status}`} order by a.id desc limit 11 offset ${offset}`,
    );
  }
  return {
    items: items.slice(0, 10),
    hasMore: items.length > 10,
    page: q.page,
  };
}
export async function moderateSocial(
  userId: number,
  data: z.infer<typeof socialAdminInput>,
) {
  return db.transaction(async (tx) => {
    const staff = await getStaffForUser(userId, tx, true);
    if (!staff) throw new HttpError(403, "Staff authorization required.");
    if (data.action === "review_appeal") {
      const [appeal] = await tx
        .select()
        .from(appeals)
        .where(eq(appeals.id, data.id))
        .for("update");
      if (!appeal) throw new HttpError(404, "Review request not found.");
      if (appeal.userId === userId)
        throw new HttpError(403, "Another moderator must review your request.");
      if (appeal.status !== "open")
        throw new HttpError(409, "This request has already been reviewed.");
      await tx
        .update(appeals)
        .set({
          status: "reviewed",
          resolution: data.resolution,
          reviewedBy: userId,
          reviewedAt: new Date(),
        })
        .where(eq(appeals.id, appeal.id));
      await audit(tx, {
        actorId: userId,
        actorRole: staff.role,
        action: "social_appeal_reviewed",
        entityType: "social_appeal",
        entityId: appeal.id,
        reason: data.resolution,
        internalNote: data.internalNote,
        snapshot: { decisionId: appeal.decisionId },
      });
      return {
        message:
          "Review response saved. Enforcement changes require a separate content decision.",
      };
    }
    if (data.action === "resolve_report") {
      const [report] = await tx
        .select()
        .from(reports)
        .where(eq(reports.id, data.id))
        .for("update");
      if (!report) throw new HttpError(404, "Report not found.");
      const owners = report.postId
        ? await tx.execute<{ owner: number }>(
            sql`select cp.user_id as owner from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.id=${report.postId}`,
          )
        : await tx.execute<{ owner: number }>(
            sql`select author_id as owner from social_comments where id=${report.commentId}`,
          );
      if (report.reporterId === userId || owners[0]?.owner === userId)
        throw new HttpError(
          403,
          "Another moderator must review reports involving your account.",
        );
      if (report.status !== "open")
        throw new HttpError(409, "This report has already been reviewed.");
      await tx
        .update(reports)
        .set({
          status: data.status,
          resolution: data.resolution,
          reviewedBy: userId,
          reviewedAt: new Date(),
        })
        .where(eq(reports.id, report.id));
      await audit(tx, {
        actorId: userId,
        actorRole: staff.role,
        action: `social_report_${data.status}`,
        entityType: "social_report",
        entityId: report.id,
        reason: data.resolution,
        internalNote: data.internalNote,
        snapshot: { postId: report.postId, commentId: report.commentId },
      });
      return { message: "Content report review saved." };
    }
    if (data.action === "remove_comment" || data.action === "restore_comment") {
      const [target] = await tx
        .select({ postId: comments.postId })
        .from(comments)
        .where(and(eq(comments.id, data.id), isNull(comments.deletedAt)));
      if (!target) throw new HttpError(404, "Comment not found.");
      // Shared parent lock follows the same order as member edits.
      await tx.execute(
        sql`select id from social_posts where id=${target.postId} for share`,
      );
      const [comment] = await tx
        .select()
        .from(comments)
        .where(and(eq(comments.id, data.id), isNull(comments.deletedAt)))
        .for("update");
      if (!comment) throw new HttpError(404, "Comment not found.");
      if (comment.authorId === userId)
        throw new HttpError(403, "Another moderator must review your comment.");
      if (comment.revision !== data.revision)
        throw new HttpError(409, "This comment changed. Reload the queue.");
      const restoring = data.action === "restore_comment";
      if (restoring && comment.status !== "removed")
        throw new HttpError(409, "Only removed comments can be restored.");
      if (restoring) {
        const post = await lockPost(tx, comment.postId, null);
        const active = await tx.execute(
          sql`select 1 where ${memberActive(comment.authorId)} and ${noBlock(comment.authorId, sql`${post.user_id}`)}`,
        );
        if (!active.length)
          throw new HttpError(
            409,
            "This author or account relationship is not eligible for restoration.",
          );
      }
      await tx
        .update(comments)
        .set({
          status: restoring ? "visible" : "removed",
          moderationReason: data.reason,
          revision: comment.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(comments.id, comment.id));
      await audit(tx, {
        actorId: userId,
        actorRole: staff.role,
        action: restoring ? "comment_restored" : "comment_removed",
        entityType: "comment",
        entityId: comment.id,
        reason: data.reason,
        internalNote: data.internalNote,
        snapshot: {
          body: comment.body,
          revision: comment.revision,
          postId: comment.postId,
        },
      });
      return { message: restoring ? "Comment restored." : "Comment removed." };
    }
    const [found] = await tx
      .select({ profileId: posts.profileId })
      .from(posts)
      .where(eq(posts.id, data.id));
    if (!found) throw new HttpError(404, "Submitted post not found.");
    const [profile] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.id, found.profileId))
      .for("share");
    const [post] = await tx
      .select()
      .from(posts)
      .where(and(eq(posts.id, data.id), isNull(posts.deletedAt)))
      .for("update");
    if (!post || post.status === "draft")
      throw new HttpError(404, "Submitted post not found.");
    if (profile.userId === userId)
      throw new HttpError(403, "Another moderator must review your post.");
    if (post.revision !== data.revision)
      throw new HttpError(409, "This post changed. Reload the queue.");
    if (
      ["approve_post", "reject_post"].includes(data.action) &&
      post.status !== "pending"
    )
      throw new HttpError(
        409,
        "Only pending posts can be approved or rejected.",
      );
    if (data.action === "restore_post" && post.status !== "removed")
      throw new HttpError(409, "Only removed posts can be restored.");
    if (data.action === "approve_post") {
      await reviewPhotos(tx, post.id, true);
      const eligible = await tx.execute(
        sql`select cp.id from creator_profiles cp join users u on u.id=cp.user_id where cp.id=${profile.id} and ${creatorEligible} for share of u`,
      );
      if (!eligible.length)
        throw new HttpError(
          409,
          "Approve the active, visible creator profile before publishing their post.",
        );
    }
    const status =
      data.action === "approve_post"
        ? "published"
        : data.action === "reject_post"
          ? "rejected"
          : data.action === "remove_post"
            ? "removed"
            : "pending";
    await tx
      .update(posts)
      .set({
        status,
        moderationReason: data.reason,
        publishedAt: status === "published" ? new Date() : null,
        updatedAt: new Date(),
        revision: post.revision + 1,
      })
      .where(eq(posts.id, post.id));
    await tx.execute(
      sql`update media_assets set moderation=${status === "published" ? "approved" : status === "rejected" ? "rejected" : status === "removed" ? "removed" : "pending"},approved_revision=${status === "published" ? post.revision + 1 : null},updated_at=now() where post_id=${post.id} and deleted_at is null`,
    );
    await tx.execute(
      sql`update video_assets set moderation=${status === "published" ? "approved" : status === "rejected" ? "rejected" : status === "removed" ? "removed" : "pending"},approved_revision=${status === "published" ? post.revision + 1 : null},updated_at=now() where post_id=${post.id} and deleted_at is null`,
    );
    const names = {
      approve_post: "post_approved",
      reject_post: "post_rejected",
      remove_post: "post_removed",
      restore_post: "post_restored",
    };
    await audit(tx, {
      actorId: userId,
      actorRole: staff.role,
      action: names[data.action],
      entityType: "post",
      entityId: post.id,
      profileId: profile.id,
      reason: data.reason,
      internalNote: data.internalNote,
      snapshot: {
        title: post.title,
        body: post.body,
        previousStatus: post.status,
        revision: post.revision,
        photos: await photoSnapshot(tx, post.id),
        video: await videoSnapshot(tx, post.id),
      },
    });
    return {
      message:
        status === "published"
          ? "Post approved and published."
          : status === "pending"
            ? "Post restored to pending review."
            : "Content decision saved.",
    };
  });
}
