// Synthetic GitHub Actions infrastructure only. Never accepts a remote database.
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
async function main() {
  const url = new URL(process.env.POSTGRES_URL || "");
  const container = process.env.CI_POSTGRES_CONTAINER || "";
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/mimi_ci" ||
    !url.port ||
    !/^[a-f0-9]{12,64}$/.test(container) ||
    !process.env.RUNNER_TEMP ||
    !process.env.GITHUB_ENV
  )
    throw new Error("Disposable CI infrastructure required.");
  const sql = postgres(url.toString());
  try {
    await sql.unsafe("CREATE DATABASE mimi_ci_staging");
    const root = await mkdtemp(join(process.env.RUNNER_TEMP, "mimi-staging-"));
    const cert = join(root, "server.crt"),
      key = join(root, "server.key");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,DNS:postgres,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    for (const [file, target] of [
      [key, "server.key"],
      [cert, "server.crt"],
    ])
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          "--user",
          "postgres",
          container,
          "sh",
          "-c",
          `umask 077; cat > "$PGDATA/${target}"`,
        ],
        { input: await readFile(file), stdio: ["pipe", "ignore", "pipe"] },
      );
    await sql.unsafe("ALTER SYSTEM SET ssl=on");
    await sql`select pg_reload_conf()`;
    url.pathname = "/mimi_ci_staging";
    url.searchParams.set("sslmode", "verify-full");
    const env = {
      APP_ENV: "staging",
      NODE_ENV: "production",
      BASE_URL: "https://127.0.0.1:3001",
      POSTGRES_URL: url.toString(),
      AUTH_SECRET: randomBytes(32).toString("hex"),
      PAYMENTS_ENABLED: "false",
      SESSION_COOKIE_SECURE: "true",
      TRUSTED_ORIGINS: "https://127.0.0.1:3001",
      TRUSTED_CLIENT_IP_HEADER: "x-mimi-client-ip",
      STAGING_ACCESS_USERNAME: "tester",
      STAGING_ACCESS_PASSWORD: randomBytes(32).toString("hex"),
      STAGING_DATA_ISOLATED: "true",
      HEALTHCHECK_TOKEN: randomBytes(32).toString("hex"),
      SIGNUP_ENABLED: "false",
      MEDIA_UPLOADS_ENABLED: "false",
      VIDEO_UPLOADS_ENABLED: "false",
      VIDEO_WORKER_ENABLED: "false",
      MEDIA_STORAGE_DRIVER: "",
      MEDIA_SCAN_MODE: "",
      VIDEO_SANDBOX_MODE: "bwrap",
      NODE_EXTRA_CA_CERTS: cert,
    };
    const path = join(root, "staging.env");
    for (const name of [
      "AUTH_SECRET",
      "STAGING_ACCESS_PASSWORD",
      "HEALTHCHECK_TOKEN",
    ])
      console.log(`::add-mask::${env[name]}`);
    await writeFile(
      path,
      Object.entries(env)
        .map(([k, v]) => k + "=" + v)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    await appendFile(
      process.env.GITHUB_ENV,
      `TEST_STAGING_ENV_FILE=${path}\nTEST_STAGING_BASE_URL=http://127.0.0.1:3001\nNODE_EXTRA_CA_CERTS=${cert}\n`,
    );
    console.log(
      "Separate synthetic staging database, verified-TLS fixture and private runtime settings prepared.",
    );
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error(
    "CI staging preparation failed; no secret details were logged.",
  );
  process.exitCode = 1;
});
