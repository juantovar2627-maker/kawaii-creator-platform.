"use server";

import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  User,
  users,
  teams,
  teamMembers,
  activityLogs,
  type NewUser,
  type NewTeam,
  type NewTeamMember,
  type NewActivityLog,
  ActivityType,
  invitations,
} from "@/lib/db/schema";
import { comparePasswords, hashPassword, setSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { actionOriginAllowed } from "@/lib/auth/abuse";
import { isPaymentsEnabled } from "@/lib/payments/config";
import { getUser, getUserWithTeam } from "@/lib/db/queries";
import {
  validatedAction,
  validatedActionWithUser,
} from "@/lib/auth/middleware";

async function logActivity(
  teamId: number | null | undefined,
  userId: number,
  type: ActivityType,
  ipAddress?: string,
) {
  if (teamId === null || teamId === undefined) {
    return;
  }
  const newActivity: NewActivityLog = {
    teamId,
    userId,
    action: type,
    ipAddress: ipAddress || "",
  };
  await db.insert(activityLogs).values(newActivity);
}

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .min(3)
    .max(255)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(100),
});

export const signIn = validatedAction(
  signInSchema,
  async (data, formData) => {
    const { email, password } = data;

    const userWithTeam = await db
      .select({
        user: users,
        team: teams,
      })
      .from(users)
      .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
      .leftJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(sql`lower(${users.email})=${email}`, isNull(users.deletedAt)))
      .limit(1);

    if (userWithTeam.length === 0) {
      await hashPassword(password);
      return {
        error: "Invalid email or password. Please try again.",
        email,
      };
    }

    const { user: foundUser, team: foundTeam } = userWithTeam[0];

    const isPasswordValid = await comparePasswords(
      password,
      foundUser.passwordHash,
    );

    if (!isPasswordValid) {
      return {
        error: "Invalid email or password. Please try again.",
        email,
      };
    }

    await Promise.all([
      setSession(foundUser),
      logActivity(foundTeam?.id, foundUser.id, ActivityType.SIGN_IN),
    ]);

    const redirectTo = formData.get("redirect") as string | null;
    if (redirectTo === "checkout" && isPaymentsEnabled()) {
      const { createCheckoutSession } = await import("@/lib/payments/stripe");
      const priceId = formData.get("priceId") as string;
      return createCheckoutSession({ team: foundTeam, priceId });
    }

    redirect("/dashboard");
  },
  "signin",
);

const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8)
    .max(100)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password must fit within 72 UTF-8 bytes.",
    ),
  inviteId: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .or(z.literal(""))
    .optional(),
});

export const signUp = validatedAction(
  signUpSchema,
  async (data) => {
    const { email, password, inviteId } = data;
    const passwordHash = await hashPassword(password);
    const created = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(74107, hashtext(${email}))`,
      );
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email})=${email}`)
        .limit(1);
      if (existing.length) return null;
      let teamId: number, userRole: string;
      if (inviteId) {
        const [invitation] = await tx
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.id, Number(inviteId)),
              sql`lower(${invitations.email})=${email}`,
              eq(invitations.status, "pending"),
            ),
          )
          .for("update");
        if (!invitation) return null;
        teamId = invitation.teamId;
        userRole = invitation.role;
        await tx
          .update(invitations)
          .set({ status: "accepted" })
          .where(eq(invitations.id, invitation.id));
      } else {
        const [team] = await tx
          .insert(teams)
          .values({ name: "My Mimi space" })
          .returning();
        teamId = team.id;
        userRole = "owner";
      }
      const [user] = await tx
        .insert(users)
        .values({ email, passwordHash, role: userRole })
        .returning();
      await tx
        .insert(teamMembers)
        .values({ userId: user.id, teamId, role: userRole });
      await tx.insert(activityLogs).values({
        userId: user.id,
        teamId,
        action: ActivityType.SIGN_UP,
        ipAddress: "",
      });
      return user;
    });
    if (!created)
      return {
        error:
          "Unable to register with these details. Ask your operator if you need help.",
        email,
      };
    await setSession(created);
    redirect("/dashboard");
  },
  "signup",
);

export async function signOut() {
  if (!(await actionOriginAllowed()))
    throw new Error("Invalid request origin.");
  const user = await getUser();
  if (!user) {
    (await cookies()).delete("session");
    return;
  }
  const userWithTeam = await getUserWithTeam(user.id);
  await logActivity(userWithTeam?.teamId, user.id, ActivityType.SIGN_OUT);
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion}+1` })
    .where(eq(users.id, user.id));
  (await cookies()).delete("session");
}

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(100),
  newPassword: z
    .string()
    .min(8)
    .max(100)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password must fit within 72 UTF-8 bytes.",
    ),
  confirmPassword: z.string().min(8).max(100),
});

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, confirmPassword } = data;

    const isPasswordValid = await comparePasswords(
      currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      return {
        error: "Current password is incorrect.",
      };
    }

    if (currentPassword === newPassword) {
      return {
        error: "New password must be different from the current password.",
      };
    }

    if (confirmPassword !== newPassword) {
      return {
        error: "New password and confirmation password do not match.",
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    const userWithTeam = await getUserWithTeam(user.id);

    const [current] = await db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        sessionVersion: sql`${users.sessionVersion}+1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, user.id),
          eq(users.sessionVersion, user.sessionVersion),
          eq(users.passwordHash, user.passwordHash),
          isNull(users.deletedAt),
        ),
      )
      .returning();
    if (!current)
      return {
        error:
          "Your account changed. Sign in again before changing your password.",
      };
    await logActivity(
      userWithTeam?.teamId,
      user.id,
      ActivityType.UPDATE_PASSWORD,
    );
    await setSession(current);
    return {
      success: "Password updated successfully.",
    };
  },
);

const deleteAccountSchema = z.object({
  password: z.string().min(8).max(100),
});

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const { password } = data;

    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      return {
        error: "Incorrect password. Account deletion failed.",
      };
    }

    const userWithTeam = await getUserWithTeam(user.id);

    const deleted = await db.transaction(async (tx) => {
      const [current] = await tx
        .update(users)
        .set({
          deletedAt: sql`CURRENT_TIMESTAMP`,
          email: sql`CONCAT('deleted-',id,'-',gen_random_uuid(),'@deleted.invalid')`,
          sessionVersion: sql`${users.sessionVersion}+1`,
        })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.sessionVersion, user.sessionVersion),
            eq(users.passwordHash, user.passwordHash),
            isNull(users.deletedAt),
          ),
        )
        .returning({ id: users.id });
      if (!current) return false;
      if (userWithTeam?.teamId)
        await tx.insert(activityLogs).values({
          teamId: userWithTeam.teamId,
          userId: user.id,
          action: ActivityType.DELETE_ACCOUNT,
          ipAddress: "",
        });
      await tx.delete(teamMembers).where(eq(teamMembers.userId, user.id));
      return true;
    });
    if (!deleted)
      return {
        error: "Your account changed. Sign in again before deleting it.",
      };

    (await cookies()).delete("session");
    redirect("/sign-in");
  },
);

const updateAccountSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(255)
    .transform((value) => value.toLowerCase()),
});

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const { name, email } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    const updated = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(74107, hashtext(${email}))`,
      );
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email})=${email} and ${users.id}<>${user.id}`)
        .limit(1);
      if (existing.length) return false;
      await tx
        .update(users)
        .set({ name, email, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return true;
    });
    if (!updated) return { error: "Unable to use these account details." };
    await logActivity(
      userWithTeam?.teamId,
      user.id,
      ActivityType.UPDATE_ACCOUNT,
    );

    return { name, success: "Account updated successfully." };
  },
);

const removeTeamMemberSchema = z.object({
  memberId: z.coerce.number().int().positive(),
});

export const removeTeamMember = validatedActionWithUser(
  removeTeamMemberSchema,
  async (data, _, user) => {
    const { memberId } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    if (!userWithTeam?.teamId) {
      return { error: "User is not part of a team" };
    }
    const [membership] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, user.id),
          eq(teamMembers.teamId, userWithTeam.teamId),
        ),
      );
    if (membership?.role !== "owner")
      return { error: "Only the team owner may manage members." };

    const [target] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.teamId, userWithTeam.teamId),
        ),
      );
    if (!target || target.role === "owner" || target.userId === user.id)
      return { error: "This membership cannot be removed." };
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.teamId, userWithTeam.teamId),
        ),
      );

    await logActivity(
      userWithTeam.teamId,
      user.id,
      ActivityType.REMOVE_TEAM_MEMBER,
    );

    return { success: "Team member removed successfully" };
  },
);

const inviteTeamMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(255)
    .transform((value) => value.toLowerCase()),
  role: z.enum(["member", "owner"]),
});

export const inviteTeamMember = validatedActionWithUser(
  inviteTeamMemberSchema,
  async (data, _, user) => {
    const { email, role } = data;
    const userWithTeam = await getUserWithTeam(user.id);

    if (!userWithTeam?.teamId) {
      return { error: "User is not part of a team" };
    }
    const [membership] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, user.id),
          eq(teamMembers.teamId, userWithTeam.teamId),
        ),
      );
    if (membership?.role !== "owner")
      return { error: "Only the team owner may manage members." };

    const existingMember = await db
      .select()
      .from(users)
      .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(users.email, email),
          eq(teamMembers.teamId, userWithTeam.teamId),
        ),
      )
      .limit(1);

    if (existingMember.length > 0) {
      return { error: "User is already a member of this team" };
    }

    // Check if there's an existing invitation
    const existingInvitation = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email),
          eq(invitations.teamId, userWithTeam.teamId),
          eq(invitations.status, "pending"),
        ),
      )
      .limit(1);

    if (existingInvitation.length > 0) {
      return { error: "An invitation has already been sent to this email" };
    }

    // Create a new invitation
    await db.insert(invitations).values({
      teamId: userWithTeam.teamId,
      email,
      role,
      invitedBy: user.id,
      status: "pending",
    });

    await logActivity(
      userWithTeam.teamId,
      user.id,
      ActivityType.INVITE_TEAM_MEMBER,
    );

    // TODO: Send invitation email and include ?inviteId={id} to sign-up URL
    // await sendInvitationEmail(email, userWithTeam.team.name, role)

    return { success: "Invitation sent successfully" };
  },
);
