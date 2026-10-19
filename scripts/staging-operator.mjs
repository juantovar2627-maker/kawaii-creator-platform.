// Offline operator only. Never imported by Next or copied into the app image.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { databaseRoleQuery } from "../lib/ops/database-role-query.mjs";
const { values } = parseArgs({
  options: {
    command: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
let sql;
try {
  const url = new URL(process.env.POSTGRES_URL || "");
  if (
    process.env.APP_ENV !== "staging" ||
    process.env.STAGING_DATA_ISOLATED !== "true" ||
    process.env.STAGING_DATABASE_NAME !==
      decodeURIComponent(url.pathname.slice(1)) ||
    !/^mimi_[a-z0-9_]*staging[a-z0-9_]*$/.test(
      process.env.STAGING_DATABASE_NAME || "",
    ) ||
    url.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error("environment");
  sql = postgres(url.toString(), {
    max: 1,
    connect_timeout: 5,
    connection: { statement_timeout: 10000 },
    onnotice: () => {},
  });
  if (values.command === "verify") {
    const [r] = await sql.unsafe(databaseRoleQuery);
    const [tls] =
      await sql`select ssl from pg_stat_ssl where pid=pg_backend_pid()`;
    if (r?.unsafe !== false || tls?.ssl !== true) throw new Error("privileges");
    console.log("PASS: verified database TLS and restricted application role.");
  } else if (values.command === "testers" && values.apply) {
    const accounts = JSON.parse(
      await readFile(process.env.STAGING_TESTER_FILE || "", "utf8"),
    );
    if (
      !Array.isArray(accounts) ||
      accounts.length !== 3 ||
      new Set(accounts.map((a) => a.kind)).size !== 3
    )
      throw new Error("accounts");
    for (const a of accounts) {
      if (
        !["creator", "member", "moderator"].includes(a.kind) ||
        !/^[a-z0-9._+-]+@example\.test$/.test(a.email) ||
        typeof a.password !== "string" ||
        a.password.length < 20 ||
        Buffer.byteLength(a.password) > 72 ||
        typeof a.name !== "string" ||
        !a.name.length ||
        a.name.length > 80
      )
        throw new Error("accounts");
      a.passwordHash = await hash(a.password, 10);
    }
    const created = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(714221019)`;
      const rows = [];
      for (const a of accounts) {
        const existing =
          await tx`select id from users where lower(email)=${a.email}`;
        if (existing.length) throw new Error("existing account");
        const [u] =
          await tx`insert into users(name,email,password_hash) values(${a.name},${a.email},${a.passwordHash}) returning id`;
        const [t] =
          await tx`insert into teams(name) values(${a.name + " synthetic space"}) returning id`;
        await tx`insert into team_members(user_id,team_id,role) values(${u.id},${t.id},'owner')`;
        rows.push({ kind: a.kind, id: u.id });
      }
      return rows;
    });
    for (const a of created)
      console.log(
        `Synthetic ${a.kind} account #${a.id} created. No staff grant was made.`,
      );
  } else throw new Error("command");
} catch {
  console.error(
    "Staging operator check failed. Check the documented command, isolated database, TLS, privileges and synthetic account input. Details withheld.",
  );
  process.exitCode = 1;
} finally {
  if (sql) await sql.end();
}
