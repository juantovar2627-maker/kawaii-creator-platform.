// Test harness only; no hosting provider or public deployment operations.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parse } from "dotenv";
async function main() {
  const env = parse(await readFile(process.env.TEST_STAGING_ENV_FILE || ""));
  const base = new URL(env.BASE_URL),
    db = new URL(env.POSTGRES_URL);
  if (
    env.APP_ENV !== "staging" ||
    !["localhost", "127.0.0.1"].includes(base.hostname) ||
    !["localhost", "127.0.0.1"].includes(db.hostname) ||
    !db.pathname.includes("staging") ||
    process.argv.slice(2).some((a) => a !== "--migrate")
  )
    throw new Error("Loopback synthetic staging fixture required.");
  if (process.argv.includes("--migrate") && env.TEST_ADMIN_POSTGRES_URL)
    env.POSTGRES_URL = env.TEST_ADMIN_POSTGRES_URL;
  const args = process.argv.includes("--migrate")
    ? ["node_modules/drizzle-kit/bin.cjs", "migrate"]
    : [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/start.ts",
        "--hostname",
        "127.0.0.1",
        "--port",
        base.port || "3001",
      ];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env, TEST_ADMIN_POSTGRES_URL: "" },
    stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Staging test process unavailable.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
main().catch(() => {
  console.error("Staging test fixture unavailable.");
  process.exitCode = 1;
});
