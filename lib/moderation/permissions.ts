import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { platformStaff, users } from "@/lib/db/schema";
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function getStaffForUser(
  userId: number,
  connection: typeof db | Transaction = db,
  lock = false,
) {
  // The trusted operator script locks this account before changing staff rights.
  // Lock it first, then read permission in a fresh statement. This serializes
  // revocation without granting the app UPDATE on platform_staff.
  if (lock)
    await connection
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("share");
  const query = connection
    .select({ userId: platformStaff.userId, role: platformStaff.role })
    .from(platformStaff)
    .innerJoin(users, eq(users.id, platformStaff.userId))
    .where(
      and(
        eq(platformStaff.userId, userId),
        eq(platformStaff.active, true),
        isNull(users.deletedAt),
      ),
    );
  const [staff] = await query;
  return staff ?? null;
}
