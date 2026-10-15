import "server-only";
import { moderationAudit } from "@/lib/db/schema";
import type { Transaction } from "./permissions";
export async function audit(
  tx: Transaction,
  event: typeof moderationAudit.$inferInsert,
) {
  const [row] = await tx
    .insert(moderationAudit)
    .values(event)
    .returning({ id: moderationAudit.id });
  return row.id;
}
