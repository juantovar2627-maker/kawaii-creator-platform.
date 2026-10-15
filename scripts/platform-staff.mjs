// Trusted operator tool only. Never import this into application routes/client code.
import "dotenv/config";
import postgres from "postgres";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    action: { type: "string" },
    "user-id": { type: "string" },
    role: { type: "string" },
    reason: { type: "string" },
    operator: { type: "string" },
  },
  strict: true,
});
const userId = Number(values["user-id"]);
if (
  !["grant", "revoke"].includes(values.action) ||
  !Number.isSafeInteger(userId) ||
  userId < 1 ||
  !["admin", "moderator"].includes(values.role) ||
  !values.reason ||
  values.reason.trim().length < 10 ||
  values.reason.length > 1000 ||
  !values.operator ||
  values.operator.length > 80
) {
  throw new Error(
    'Usage: node scripts/platform-staff.mjs --action grant|revoke --user-id ID --role admin|moderator --operator OPERATOR_LABEL --reason "At least 10 characters"',
  );
}
if (!process.env.POSTGRES_URL)
  throw new Error(
    "POSTGRES_URL must be supplied through the trusted operator environment.",
  );
const sql = postgres(process.env.POSTGRES_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(714221018)`;
    const [user] =
      await tx`select id,deleted_at from users where id=${userId} for update`;
    if (!user || (values.action === "grant" && user.deleted_at))
      throw new Error(
        "An active, existing account is required to grant staff access.",
      );
    const [current] =
      await tx`select role,active from platform_staff where user_id=${userId} for update`;
    if (
      current?.active &&
      current.role === "admin" &&
      (values.action === "revoke" || values.role !== "admin")
    ) {
      const [{ n }] =
        await tx`select count(*)::int as n from platform_staff s join users u on u.id=s.user_id where s.active and s.role='admin' and u.deleted_at is null and s.user_id<>${userId}`;
      if (!n)
        throw new Error(
          "Provision another active administrator before removing the last one.",
        );
    }
    if (values.action === "revoke") {
      if (!current?.active)
        throw new Error("This account has no active staff permission.");
      await tx`update platform_staff set active=false where user_id=${userId}`;
    } else {
      await tx`insert into platform_staff (user_id,role,active) values (${userId},${values.role},true) on conflict(user_id) do update set role=excluded.role,active=true,granted_at=now()`;
    }
    const snapshot = {
      previousRole: current?.role || null,
      previousActive: current?.active || false,
      role: values.action === "revoke" ? current.role : values.role,
      operator: values.operator,
    };
    await tx`insert into moderation_audit (actor_role,action,entity_type,entity_id,reason,snapshot) values ('operator',${values.action === "grant" ? "staff_granted" : "staff_revoked"},'permission',${userId},${values.reason},${tx.json(snapshot)})`;
  });
  console.log(
    `Staff permission ${values.action} completed for account #${userId}; audit record saved.`,
  );
} finally {
  await sql.end();
}
