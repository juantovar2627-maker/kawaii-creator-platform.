// Least-privilege fixture only: guarded loopback staging DB, never production.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import postgres from "postgres";
async function main() {
  const path = process.env.TEST_STAGING_ENV_FILE || "",
    env = parse(await readFile(path));
  const url = new URL(env.POSTGRES_URL);
  if (
    env.APP_ENV !== "staging" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.includes("staging") ||
    env.TEST_ADMIN_POSTGRES_URL
  )
    throw new Error("Unmodified loopback staging fixture required.");
  const sql = postgres(url.toString());
  const role = "mimi_test_app_" + randomBytes(6).toString("hex"),
    password = randomBytes(32).toString("hex");
  try {
    await sql.unsafe(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    await sql.unsafe(
      `GRANT CONNECT ON DATABASE "${url.pathname.slice(1)}" TO "${role}"`,
    );
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await sql.unsafe(
      `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}"`,
    );
    const tables = [
      "teams",
      "team_members",
      "invitations",
      "creator_profiles",
      "creator_mutation_limits",
      "account_blocks",
      "profile_reports",
      "moderation_appeals",
      "safety_rate_limits",
      "creator_follows",
      "social_posts",
      "social_comments",
      "post_likes",
      "saved_posts",
      "social_reports",
      "social_appeals",
      "media_assets",
      "video_assets",
      "video_jobs",
      "auth_rate_limits",
    ];
    await sql.unsafe(
      `GRANT INSERT,UPDATE,DELETE ON ${tables.map((t) => '"' + t + '"').join(",")} TO "${role}"`,
    );
    await sql.unsafe(`GRANT INSERT,UPDATE ON users TO "${role}"`);
    await sql.unsafe(
      `GRANT INSERT ON moderation_audit,activity_logs TO "${role}"`,
    );
    await sql.unsafe(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    );
    env.TEST_ADMIN_POSTGRES_URL = env.POSTGRES_URL;
    url.username = role;
    url.password = password;
    env.POSTGRES_URL = url.toString();
    await writeFile(
      path,
      Object.entries(env)
        .map(([k, v]) => k + "=" + v)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    console.log(
      "Staging application fixture has no staff-permission writes, audit rewrites, schema ownership or role administration.",
    );
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error("Staging database-role fixture preparation failed.");
  process.exitCode = 1;
});
