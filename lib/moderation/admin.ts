import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  creatorProfiles as profiles,
  moderationAppeals as appeals,
  moderationAudit as history,
  profileReports as reports,
  users,
} from "@/lib/db/schema";
import { publicCreatorColumns } from "@/lib/creators/queries";
import { adminInput, queueInput } from "./validation";
import { getStaffForUser } from "./permissions";
import { HttpError } from "./http";
import { audit } from "./audit";
import type { z } from "zod";

export async function getModerationQueue(query: z.infer<typeof queueInput>) {
  const offset = (query.page - 1) * 20;
  const [pending, openReports, openAppeals] = await Promise.all([
    db
      .select({ n: count() })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(
        and(
          isNull(users.deletedAt),
          eq(profiles.visibility, "listed"),
          eq(profiles.moderationStatus, "pending"),
          eq(profiles.listingRejected, false),
        ),
      ),
    db.select({ n: count() }).from(reports).where(eq(reports.status, "open")),
    db.select({ n: count() }).from(appeals).where(eq(appeals.status, "open")),
  ]);
  const overview = {
    pending: pending[0].n,
    reports: openReports[0].n,
    appeals: openAppeals[0].n,
  };
  if (query.kind === "profile") {
    if (!query.id) throw new HttpError(400, "Choose a profile.");
    const [profile] = await db
      .select({
        ...publicCreatorColumns,
        id: profiles.id,
        revision: profiles.revision,
        visibility: profiles.visibility,
        moderationStatus: profiles.moderationStatus,
        listingRejected: profiles.listingRejected,
        moderationReason: profiles.moderationReason,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(and(eq(profiles.id, query.id), isNull(users.deletedAt)));
    if (!profile) throw new HttpError(404, "Profile not found.");
    const decisions = await db
      .select({
        id: history.id,
        action: history.action,
        reason: history.reason,
        internalNote: history.internalNote,
        snapshot: history.snapshot,
        actorRole: history.actorRole,
        createdAt: history.createdAt,
      })
      .from(history)
      .where(eq(history.profileId, profile.id))
      .orderBy(desc(history.id))
      .limit(21)
      .offset(offset);
    return {
      overview,
      profile,
      items: decisions.slice(0, 20),
      hasMore: decisions.length > 20,
      page: query.page,
    };
  }
  let items;
  if (query.kind === "profiles") {
    const search = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    const filter =
      query.status === "rejected"
        ? eq(profiles.listingRejected, true)
        : query.status === "pending"
          ? and(
              eq(profiles.moderationStatus, "pending"),
              eq(profiles.listingRejected, false),
              eq(profiles.visibility, "listed"),
            )
          : query.status === "approved" || query.status === "suspended"
            ? eq(profiles.moderationStatus, query.status)
            : undefined;
    if (
      !["all", "pending", "approved", "rejected", "suspended"].includes(
        query.status,
      )
    )
      throw new HttpError(400, "Invalid profile status.");
    items = await db
      .select({
        id: profiles.id,
        title: profiles.displayName,
        username: profiles.username,
        status: profiles.moderationStatus,
        rejected: profiles.listingRejected,
        visibility: profiles.visibility,
        reason: profiles.moderationReason,
        createdAt: profiles.updatedAt,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(
        and(
          isNull(users.deletedAt),
          filter,
          or(
            ilike(profiles.username, search),
            ilike(profiles.displayName, search),
          ),
        ),
      )
      .orderBy(asc(profiles.id))
      .limit(21)
      .offset(offset);
  } else if (query.kind === "reports") {
    if (!["all", "open", "resolved", "dismissed"].includes(query.status))
      throw new HttpError(400, "Invalid report status.");
    items = await db
      .select({
        id: reports.id,
        profileId: reports.profileId,
        title: reports.targetUsername,
        reason: reports.reason,
        explanation: reports.explanation,
        snapshot: reports.snapshot,
        status: reports.status,
        resolution: reports.resolution,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(
        query.status === "all"
          ? undefined
          : eq(
              reports.status,
              query.status as "open" | "resolved" | "dismissed",
            ),
      )
      .orderBy(desc(reports.id))
      .limit(21)
      .offset(offset);
  } else if (query.kind === "appeals") {
    if (!["all", "open", "reviewed"].includes(query.status))
      throw new HttpError(400, "Invalid review-request status.");
    items = await db
      .select({
        id: appeals.id,
        profileId: appeals.profileId,
        decisionId: appeals.decisionId,
        title: profiles.username,
        explanation: appeals.explanation,
        status: appeals.status,
        resolution: appeals.resolution,
        createdAt: appeals.createdAt,
        reason: history.reason,
      })
      .from(appeals)
      .innerJoin(profiles, eq(profiles.id, appeals.profileId))
      .innerJoin(history, eq(history.id, appeals.decisionId))
      .where(
        query.status === "all"
          ? undefined
          : eq(appeals.status, query.status as "open" | "reviewed"),
      )
      .orderBy(desc(appeals.id))
      .limit(21)
      .offset(offset);
  } else {
    items = await db
      .select({
        id: history.id,
        title: history.action,
        reason: history.reason,
        internalNote: history.internalNote,
        profileId: history.profileId,
        snapshot: history.snapshot,
        status: history.actorRole,
        createdAt: history.createdAt,
      })
      .from(history)
      .orderBy(desc(history.id))
      .limit(21)
      .offset(offset);
  }
  return {
    overview,
    items: items.slice(0, 20),
    hasMore: items.length > 20,
    page: query.page,
  };
}

export async function mutateModeration(
  userId: number,
  command: z.infer<typeof adminInput>,
) {
  return db.transaction(async (tx) => {
    // Shared locks linearize decisions with permission revocation/deletion.
    const staff = await getStaffForUser(userId, tx, true);
    if (!staff) throw new HttpError(403, "Staff authorization required.");
    if (command.action === "resolve_report") {
      const [report] = await tx
        .select()
        .from(reports)
        .where(eq(reports.id, command.reportId))
        .for("update");
      if (!report) throw new HttpError(404, "Report not found.");
      const [target] = await tx
        .select({ userId: profiles.userId })
        .from(profiles)
        .where(eq(profiles.id, report.profileId));
      if (report.reporterId === userId || target?.userId === userId)
        throw new HttpError(
          403,
          "Another moderator must review reports involving your account.",
        );
      if (report.status !== "open")
        throw new HttpError(409, "This report has already been reviewed.");
      await tx
        .update(reports)
        .set({
          status: command.status,
          resolution: command.resolution,
          reviewedBy: userId,
          reviewedAt: new Date(),
        })
        .where(eq(reports.id, report.id));
      await audit(tx, {
        actorId: userId,
        actorRole: staff.role,
        action: `report_${command.status}`,
        entityType: "report",
        entityId: report.id,
        profileId: report.profileId,
        reason: command.resolution,
        internalNote: command.internalNote,
        snapshot: { previousStatus: report.status, reason: report.reason },
      });
      return { message: "Report review saved." };
    }
    if (command.action === "review_appeal") {
      const [appeal] = await tx
        .select()
        .from(appeals)
        .where(eq(appeals.id, command.appealId))
        .for("update");
      if (!appeal) throw new HttpError(404, "Review request not found.");
      if (appeal.userId === userId)
        throw new HttpError(403, "Another moderator must review your request.");
      if (appeal.status !== "open")
        throw new HttpError(409, "This request has already been reviewed.");
      // A review response never silently overrides a newer enforcement action.
      // Staff must explicitly use the revision-checked profile controls to change it.
      await tx
        .update(appeals)
        .set({
          status: "reviewed",
          resolution: command.resolution,
          reviewedBy: userId,
          reviewedAt: new Date(),
        })
        .where(eq(appeals.id, appeal.id));
      await audit(tx, {
        actorId: userId,
        actorRole: staff.role,
        action: "appeal_reviewed",
        entityType: "appeal",
        entityId: appeal.id,
        profileId: appeal.profileId,
        reason: command.resolution,
        internalNote: command.internalNote,
        snapshot: { decisionId: appeal.decisionId },
      });
      return {
        message:
          "Review response saved. Profile enforcement changes require a separate decision.",
      };
    }
    const [profile] = await tx
      .select({
        ...publicCreatorColumns,
        id: profiles.id,
        userId: profiles.userId,
        revision: profiles.revision,
        visibility: profiles.visibility,
        moderationStatus: profiles.moderationStatus,
        listingRejected: profiles.listingRejected,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(and(eq(profiles.id, command.profileId), isNull(users.deletedAt)))
      .for("update");
    if (!profile) throw new HttpError(404, "Profile not found.");
    if (profile.userId === userId)
      throw new HttpError(403, "Another moderator must review your profile.");
    if (profile.revision !== command.revision)
      throw new HttpError(
        409,
        "This profile changed. Reload and review the latest version.",
      );
    if (
      (command.action === "approve" || command.action === "reject") &&
      (profile.visibility !== "listed" ||
        profile.moderationStatus === "suspended")
    )
      throw new HttpError(
        409,
        "Only an active discovery request can be approved or rejected.",
      );
    if (
      command.action === "restore" &&
      profile.moderationStatus !== "suspended"
    )
      throw new HttpError(409, "This profile is not suspended.");
    const moderationStatus =
      command.action === "approve"
        ? "approved"
        : command.action === "suspend"
          ? "suspended"
          : "pending";
    await tx
      .update(profiles)
      .set({
        moderationStatus,
        listingRejected: command.action === "reject",
        moderationReason: command.reason,
        revision: profile.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, profile.id));
    const names = {
      approve: "profile_approved",
      reject: "profile_rejected",
      suspend: "profile_suspended",
      restore: "profile_restored",
    };
    const { userId: ownerId, ...snapshot } = profile;
    await audit(tx, {
      actorId: userId,
      actorRole: staff.role,
      action: names[command.action],
      entityType: "profile",
      entityId: profile.id,
      profileId: profile.id,
      reason: command.reason,
      internalNote: command.internalNote,
      snapshot,
    });
    return {
      message:
        command.action === "restore"
          ? "Profile restored to pending review; discovery approval is still required."
          : "Moderation decision saved.",
    };
  });
}
