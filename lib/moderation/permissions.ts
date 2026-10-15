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
  const [staff] = await (lock ? query.for("share") : query);
  return staff ?? null;
}
