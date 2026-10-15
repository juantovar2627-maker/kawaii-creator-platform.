import "server-only";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  accountBlocks as blocks,
  creatorProfiles as profiles,
  moderationAppeals as appeals,
  moderationAudit as history,
  profileReports as reports,
  users,
} from "@/lib/db/schema";
import { HttpError } from "./http";
import { audit } from "./audit";
import { safetyInput } from "./validation";
import type { z } from "zod";
import { publicCreatorColumns } from "@/lib/creators/queries";
import { lockPair } from "@/lib/social/access";
import { sql } from "drizzle-orm";

export async function getOwnSafety(userId: number, page = 1) {
  const offset = (page - 1) * 20;
  const [blocked, submitted, decisions, requests] = await Promise.all([
    db
      .select({
        id: blocks.id,
        username: blocks.targetUsername,
        displayName: blocks.targetDisplayName,
        createdAt: blocks.createdAt,
      })
      .from(blocks)
      .where(eq(blocks.blockerId, userId))
      .orderBy(desc(blocks.id))
      .limit(21)
      .offset(offset),
    db
      .select({
        id: reports.id,
        username: reports.targetUsername,
        reason: reports.reason,
        explanation: reports.explanation,
        status: reports.status,
        resolution: reports.resolution,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.reporterId, userId))
      .orderBy(desc(reports.id))
      .limit(21)
      .offset(offset),
    db
      .select({
        id: history.id,
        action: history.action,
        reason: history.reason,
        createdAt: history.createdAt,
      })
      .from(history)
      .innerJoin(profiles, eq(profiles.id, history.profileId))
      .where(
        and(
          eq(profiles.userId, userId),
          inArray(history.action, [
            "profile_approved",
            "profile_rejected",
            "profile_suspended",
            "profile_restored",
          ]),
        ),
      )
      .orderBy(desc(history.id))
      .limit(21)
      .offset(offset),
    db
      .select({
        id: appeals.id,
        decisionId: appeals.decisionId,
        explanation: appeals.explanation,
        status: appeals.status,
        resolution: appeals.resolution,
        createdAt: appeals.createdAt,
      })
      .from(appeals)
      .where(eq(appeals.userId, userId))
      .orderBy(desc(appeals.id))
      .limit(21)
      .offset(offset),
  ]);
  return {
    blocks: blocked.slice(0, 20),
    reports: submitted.slice(0, 20),
    decisions: decisions.slice(0, 20),
    appeals: requests.slice(0, 20),
    page,
    hasMore: [blocked, submitted, decisions, requests].some(
      (items) => items.length > 20,
    ),
  };
}

export async function mutateSafety(
  userId: number,
  data: z.infer<typeof safetyInput>,
) {
  return db.transaction(async (tx) => {
    if (data.action === "unblock") {
      const removed = await tx
        .delete(blocks)
        .where(and(eq(blocks.id, data.blockId), eq(blocks.blockerId, userId)))
        .returning({ id: blocks.id });
      if (!removed.length) throw new HttpError(404, "Block not found.");
      return { message: "Account unblocked." };
    }
    if (data.action === "appeal") {
      const [decision] = await tx
        .select({ id: history.id, profileId: profiles.id })
        .from(history)
        .innerJoin(profiles, eq(profiles.id, history.profileId))
        .where(
          and(
            eq(history.id, data.decisionId),
            eq(profiles.userId, userId),
            inArray(history.action, ["profile_rejected", "profile_suspended"]),
          ),
        )
        .for("share");
      if (!decision) throw new HttpError(404, "Reviewable decision not found.");
      const [request] = await tx
        .insert(appeals)
        .values({
          userId,
          profileId: decision.profileId,
          decisionId: decision.id,
          explanation: data.explanation,
        })
        .onConflictDoNothing()
        .returning({ id: appeals.id });
      if (!request)
        throw new HttpError(
          409,
          "You already requested review of this decision.",
        );
      await audit(tx, {
        actorId: userId,
        actorRole: "member",
        action: "appeal_created",
        entityType: "appeal",
        entityId: request.id,
        profileId: decision.profileId,
        reason: "Creator requested another review.",
      });
      return { message: "Your review request was saved.", id: request.id };
    }
    const [target] = await tx
      .select({
        ...publicCreatorColumns,
        id: profiles.id,
        userId: profiles.userId,
      })
      .from(profiles)
      .innerJoin(users, eq(profiles.userId, users.id))
      .where(
        and(
          eq(profiles.username, data.username),
          ne(profiles.visibility, "hidden"),
          ne(profiles.moderationStatus, "suspended"),
          isNull(users.deletedAt),
        ),
      )
      .for("share");
    if (!target) throw new HttpError(404, "Public creator not found.");
    if (target.userId === userId)
      throw new HttpError(400, "You cannot report or block yourself.");
    if (data.action === "block") {
      await lockPair(tx, userId, target.userId);
      const [block] = await tx
        .insert(blocks)
        .values({
          blockerId: userId,
          blockedId: target.userId,
          targetUsername: target.username,
          targetDisplayName: target.displayName,
        })
        .onConflictDoNothing()
        .returning({ id: blocks.id });
      if (!block) throw new HttpError(409, "This account is already blocked.");
      await tx.execute(
        sql`delete from creator_follows where (follower_id=${userId} and creator_id=${target.userId}) or (follower_id=${target.userId} and creator_id=${userId})`,
      );
      return {
        message: "Account blocked. Manage your blocks in Community Safety.",
        id: block.id,
      };
    }
    const { id: profileId, userId: ownerId, ...snapshot } = target;
    const [report] = await tx
      .insert(reports)
      .values({
        reporterId: userId,
        profileId: target.id,
        targetUsername: target.username,
        reason: data.reason,
        explanation: data.explanation,
        snapshot,
      })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    if (!report)
      throw new HttpError(
        409,
        "An open report for this creator already exists.",
      );
    await audit(tx, {
      actorId: userId,
      actorRole: "member",
      action: "report_created",
      entityType: "report",
      entityId: report.id,
      profileId: target.id,
      reason: "Community report received.",
    });
    return {
      message: "Your report was saved for moderator review.",
      id: report.id,
    };
  });
}
