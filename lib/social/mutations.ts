import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  accountBlocks as blocks,
  creatorProfiles as profiles,
  creatorFollows as follows,
  socialPosts as posts,
  socialComments as comments,
  postLikes as likes,
  savedPosts as saves,
  socialReports as reports,
  socialAppeals as appeals,
  moderationAudit as history,
} from "@/lib/db/schema";
import { audit } from "@/lib/moderation/audit";
import { HttpError } from "@/lib/moderation/http";
import {
  assertActive,
  lockPair,
  lockPost,
  memberActive,
  noBlock,
} from "./access";
import { socialInput } from "./validation";
import type { z } from "zod";

export async function mutateSocial(
  userId: number,
  data: z.infer<typeof socialInput>,
) {
  return db.transaction(async (tx) => {
    const withdrawing =
      (data.action === "follow" && !data.following) ||
      (data.action === "like" && !data.liked) ||
      (data.action === "save" && !data.saved) ||
      [
        "delete_post",
        "delete_comment",
        "report",
        "appeal",
        "block_comment_author",
      ].includes(data.action);
    if (!withdrawing) await assertActive(userId, tx);
    if (data.action === "follow") {
      const [target] = await tx
        .select({ userId: profiles.userId })
        .from(profiles)
        .where(eq(profiles.username, data.username));
      if (!target) {
        if (!data.following) return { message: "Creator unfollowed." };
        throw new HttpError(404, "Creator not found.");
      }
      if (target.userId === userId)
        throw new HttpError(400, "You cannot follow yourself.");
      await lockPair(tx, userId, target.userId);
      if (!data.following) {
        await tx
          .delete(follows)
          .where(
            and(
              eq(follows.followerId, userId),
              eq(follows.creatorId, target.userId),
            ),
          );
        return { message: "Creator unfollowed." };
      }
      const permitted = await tx.execute(
        sql`select cp.id from creator_profiles cp join users u on u.id=cp.user_id where cp.user_id=${target.userId} and cp.visibility<>'hidden' and cp.moderation_status<>'suspended' and u.deleted_at is null and ${noBlock(userId, sql`cp.user_id`)} for share of cp,u`,
      );
      if (!permitted.length)
        throw new HttpError(404, "Public creator not found.");
      await tx
        .insert(follows)
        .values({ followerId: userId, creatorId: target.userId })
        .onConflictDoNothing();
      return { message: "Creator followed." };
    }
    if (data.action === "create_post") {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .for("share");
      if (!profile)
        throw new HttpError(
          403,
          "Set up My Creator Space before writing a post.",
        );
      const [post] = await tx
        .insert(posts)
        .values({ profileId: profile.id, title: data.title, body: data.body })
        .returning({ id: posts.id, revision: posts.revision });
      return { message: "Draft saved to your account.", ...post };
    }
    if (["edit_post", "delete_post", "submit_post"].includes(data.action)) {
      // Narrowing explicitly keeps public command schemas independent of ORM rows.
      if (
        data.action !== "edit_post" &&
        data.action !== "delete_post" &&
        data.action !== "submit_post"
      )
        throw new HttpError(400, "Invalid post action.");
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .for("share");
      if (!profile) throw new HttpError(404, "Your post was not found.");
      const [post] = await tx
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.id, data.id),
            eq(posts.profileId, profile.id),
            isNull(posts.deletedAt),
          ),
        )
        .for("update");
      if (!post) throw new HttpError(404, "Your post was not found.");
      if (post.revision !== data.revision)
        throw new HttpError(
          409,
          "This post changed. Reload before trying again.",
        );
      if (data.action === "delete_post") {
        await tx
          .update(posts)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
            revision: post.revision + 1,
          })
          .where(eq(posts.id, post.id));
        await audit(tx, {
          actorId: userId,
          actorRole: "member",
          action: "post_withdrawn",
          entityType: "post",
          entityId: post.id,
          profileId: profile.id,
          reason: "Creator withdrew their post.",
          snapshot: {
            status: post.status,
            revision: post.revision,
          },
        });
        return { message: "Post withdrawn and removed from your list." };
      }
      if (post.status === "removed")
        throw new HttpError(
          403,
          "A removed post cannot be edited or resubmitted. Request a review in Social Activity.",
        );
      if (data.action === "submit_post") {
        if (!["draft", "rejected"].includes(post.status))
          throw new HttpError(
            409,
            "Only a draft or rejected post can be submitted.",
          );
        if (
          profile.visibility === "hidden" ||
          profile.moderationStatus === "suspended"
        )
          throw new HttpError(
            403,
            "A hidden or suspended creator cannot submit a post.",
          );
        await tx
          .update(posts)
          .set({
            status: "pending",
            moderationReason: "",
            revision: post.revision + 1,
            updatedAt: new Date(),
            publishedAt: null,
          })
          .where(eq(posts.id, post.id));
        await audit(tx, {
          actorId: userId,
          actorRole: "member",
          action: "post_submitted",
          entityType: "post",
          entityId: post.id,
          profileId: profile.id,
          reason: "Creator submitted text for moderation.",
          snapshot: {
            title: post.title,
            body: post.body,
            revision: post.revision + 1,
          },
        });
        return { message: "Post submitted for moderation." };
      }
      await tx
        .update(posts)
        .set({
          title: data.title,
          body: data.body,
          status: "draft",
          moderationReason: "",
          publishedAt: null,
          revision: post.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, post.id));
      await audit(tx, {
        actorId: userId,
        actorRole: "member",
        action: "post_edited",
        entityType: "post",
        entityId: post.id,
        profileId: profile.id,
        reason: "Edited content withdrawn to draft; fresh approval required.",
        snapshot: {
          previousStatus: post.status,
          previousRevision: post.revision,
        },
      });
      return {
        message: "Draft saved. Submit it for a fresh moderation review.",
      };
    }
    if (data.action === "appeal") {
      const [decision] = await tx
        .select()
        .from(history)
        .where(eq(history.id, data.decisionId));
      if (
        !decision ||
        !["post_rejected", "post_removed", "comment_removed"].includes(
          decision.action,
        )
      )
        throw new HttpError(404, "Reviewable decision not found.");
      const owned =
        decision.entityType === "post"
          ? await tx.execute(
              sql`select p.id from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.id=${decision.entityId} and cp.user_id=${userId}`,
            )
          : await tx.execute(
              sql`select id from social_comments where id=${decision.entityId} and author_id=${userId}`,
            );
      if (!owned.length)
        throw new HttpError(404, "Reviewable decision not found.");
      const [appeal] = await tx
        .insert(appeals)
        .values({
          userId,
          decisionId: decision.id,
          explanation: data.explanation,
        })
        .onConflictDoNothing()
        .returning({ id: appeals.id });
      if (!appeal)
        throw new HttpError(
          409,
          "A review request for this decision already exists.",
        );
      await audit(tx, {
        actorId: userId,
        actorRole: "member",
        action: "social_appeal_created",
        entityType: "social_appeal",
        entityId: appeal.id,
        reason: "Member requested another content review.",
      });
      return { message: "Your review request was saved." };
    }
    if (data.action === "block_comment_author") {
      const [comment] = await tx
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.id, data.commentId),
            eq(comments.status, "visible"),
            isNull(comments.deletedAt),
          ),
        );
      if (!comment) throw new HttpError(404, "Public comment not found.");
      if (comment.authorId === userId)
        throw new HttpError(400, "You cannot block yourself.");
      await lockPair(tx, userId, comment.authorId);
      await lockPost(tx, comment.postId, userId);
      const visible = await tx.execute(
        sql`select 1 where ${memberActive(comment.authorId)} and ${noBlock(userId, sql`${comment.authorId}`)}`,
      );
      if (!visible.length)
        throw new HttpError(404, "Public comment not found.");
      const [identity] = await tx
        .select({
          username: profiles.username,
          displayName: profiles.displayName,
        })
        .from(profiles)
        .where(
          and(
            eq(profiles.userId, comment.authorId),
            sql`${profiles.visibility}<>'hidden'`,
          ),
        );
      await tx
        .insert(blocks)
        .values({
          blockerId: userId,
          blockedId: comment.authorId,
          targetUsername: identity?.username || "mimi_member",
          targetDisplayName: identity?.displayName || "Mimi member",
        })
        .onConflictDoNothing();
      await tx.execute(
        sql`delete from creator_follows where (follower_id=${userId} and creator_id=${comment.authorId}) or (follower_id=${comment.authorId} and creator_id=${userId})`,
      );
      return {
        message:
          "Comment author blocked across signed-in social spaces. Manage blocks in Community Safety.",
      };
    }
    if (data.action === "like" || data.action === "save") {
      const table = data.action === "like" ? likes : saves;
      const enabled = data.action === "like" ? data.liked : data.saved;
      if (!enabled) {
        await tx
          .delete(table)
          .where(and(eq(table.userId, userId), eq(table.postId, data.postId)));
        return {
          message: data.action === "like" ? "Like removed." : "Post unsaved.",
        };
      }
      const [target] = await tx.execute<{ user_id: number }>(
        sql`select cp.user_id from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.id=${data.postId}`,
      );
      if (!target) throw new HttpError(404, "Public post not found.");
      await lockPair(tx, userId, target.user_id);
      await lockPost(tx, data.postId, userId);
      await tx
        .insert(table)
        .values({ userId, postId: data.postId })
        .onConflictDoNothing();
      return {
        message:
          data.action === "like" ? "Post liked." : "Post saved privately.",
      };
    }
    if (data.action === "comment") {
      const [target] = await tx.execute<{ user_id: number }>(
        sql`select cp.user_id from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.id=${data.postId}`,
      );
      if (!target) throw new HttpError(404, "Public post not found.");
      await lockPair(tx, userId, target.user_id);
      await lockPost(tx, data.postId, userId);
      const [comment] = await tx
        .insert(comments)
        .values({ postId: data.postId, authorId: userId, body: data.body })
        .returning({ id: comments.id });
      return { message: "Comment posted.", id: comment.id };
    }
    if (data.action === "edit_comment" || data.action === "delete_comment") {
      // Lock the parent first, matching moderation order; never resurrect a removal.
      const [found] = await tx
        .select({ postId: comments.postId })
        .from(comments)
        .where(
          and(
            eq(comments.id, data.id),
            eq(comments.authorId, userId),
            isNull(comments.deletedAt),
          ),
        );
      if (!found) throw new HttpError(404, "Your comment was not found.");
      if (data.action === "edit_comment") {
        const [owner] = await tx.execute<{ user_id: number }>(
          sql`select cp.user_id from social_posts p join creator_profiles cp on cp.id=p.profile_id where p.id=${found.postId}`,
        );
        if (!owner) throw new HttpError(404, "Post not found.");
        await lockPair(tx, userId, owner.user_id);
        await lockPost(tx, found.postId, userId);
      }
      const [comment] = await tx
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.id, data.id),
            eq(comments.authorId, userId),
            isNull(comments.deletedAt),
          ),
        )
        .for("update");
      if (!comment) throw new HttpError(404, "Your comment was not found.");
      if (comment.revision !== data.revision)
        throw new HttpError(
          409,
          "This comment changed. Reload before trying again.",
        );
      if (data.action === "edit_comment" && comment.status !== "visible")
        throw new HttpError(
          403,
          "Removed comments cannot be edited. Request another review in Social Activity.",
        );
      await tx
        .update(comments)
        .set({
          ...(data.action === "delete_comment"
            ? { deletedAt: new Date() }
            : { body: data.body }),
          revision: comment.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(comments.id, comment.id));
      return {
        message:
          data.action === "delete_comment"
            ? "Comment deleted."
            : "Comment updated.",
      };
    }
    if (data.action === "report") {
      let snapshot: Record<string, unknown>;
      let postId: number | null = null,
        commentId: number | null = null;
      if (data.target === "post") {
        const post = await lockPost(tx, data.id, userId);
        if (post.user_id === userId)
          throw new HttpError(400, "You cannot report your own post.");
        postId = post.id;
        snapshot = {
          id: post.id,
          title: post.title,
          body: post.body,
          revision: post.revision,
        };
      } else {
        const [comment] = await tx
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.id, data.id),
              isNull(comments.deletedAt),
              eq(comments.status, "visible"),
            ),
          )
          .for("share");
        if (!comment) throw new HttpError(404, "Public comment not found.");
        await lockPost(tx, comment.postId, userId);
        const allowed = await tx.execute(
          sql`select 1 where ${memberActive(comment.authorId)} and ${noBlock(userId, sql`${comment.authorId}`)}`,
        );
        if (!allowed.length)
          throw new HttpError(404, "Public comment not found.");
        if (comment.authorId === userId)
          throw new HttpError(400, "You cannot report your own comment.");
        commentId = comment.id;
        snapshot = {
          id: comment.id,
          postId: comment.postId,
          body: comment.body,
          revision: comment.revision,
        };
      }
      const [report] = await tx
        .insert(reports)
        .values({
          reporterId: userId,
          postId,
          commentId,
          reason: data.reason,
          explanation: data.explanation,
          snapshot,
        })
        .onConflictDoNothing()
        .returning({ id: reports.id });
      if (!report)
        throw new HttpError(
          409,
          "An open report for this item already exists.",
        );
      await audit(tx, {
        actorId: userId,
        actorRole: "member",
        action: "social_report_created",
        entityType: "social_report",
        entityId: report.id,
        reason: "Community content report received.",
      });
      return { message: "Your report was saved for moderator review." };
    }
    throw new HttpError(400, "Unknown social action.");
  });
}
