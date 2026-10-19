// Disposable CI only. Live staging accounts require the reviewed offline workflow.
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { parse } from "dotenv";
try {
  const env = parse(await readFile(process.env.TEST_STAGING_ENV_FILE || ""));
  const url = new URL(env.TEST_ADMIN_POSTGRES_URL || "");
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/mimi_ci_staging" ||
    !process.env.GITHUB_ENV
  )
    throw new Error("fixture");
  const tag = randomBytes(6).toString("hex");
  const accounts = ["creator", "member", "moderator"].map((kind) => ({
    kind,
    name: `Synthetic ${kind}`,
    email: `smoke-${kind}-${tag}@example.test`,
    password: randomBytes(24).toString("hex"),
  }));
  for (const a of accounts) console.log(`::add-mask::${a.password}`);
  const root = dirname(process.env.TEST_STAGING_ENV_FILE);
  const path = join(root, `testers-${tag}.json`);
  await writeFile(path, JSON.stringify(accounts), { mode: 0o600, flag: "wx" });
  const provision = execFileSync(
    process.execPath,
    ["scripts/staging-operator.mjs", "--command", "testers", "--apply"],
    {
      env: {
        ...process.env,
        ...env,
        POSTGRES_URL: url.toString(),
        STAGING_DATABASE_NAME: "mimi_ci_staging",
        STAGING_TESTER_FILE: path,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const moderator = provision.match(
    /Synthetic moderator account #(\d+) created/,
  );
  if (!moderator) throw new Error("provision");
  execFileSync(
    process.execPath,
    [
      "scripts/platform-staff.mjs",
      "--action",
      "grant",
      "--user-id",
      moderator[1],
      "--role",
      "moderator",
      "--operator",
      "ci-synthetic-smoke",
      "--reason",
      "Provision isolated staging smoke moderator fixture.",
    ],
    { env: { ...process.env, POSTGRES_URL: url.toString() }, stdio: "pipe" },
  );
  const file = join(root, `smoke-${tag}.json`);
  const smokeUrl = new URL(process.env.TEST_STAGING_BASE_URL);
  smokeUrl.port = "3002";
  await writeFile(
    file,
    JSON.stringify({
      baseUrl: smokeUrl.origin,
      canonicalOrigin: env.BASE_URL,
      basicUsername: env.STAGING_ACCESS_USERNAME,
      basicPassword: env.STAGING_ACCESS_PASSWORD,
      accounts,
    }),
    { mode: 0o600, flag: "wx" },
  );
  await appendFile(
    process.env.GITHUB_ENV,
    `STAGING_SMOKE_FILE=${file}\nSTAGING_SMOKE_ALLOWED_ORIGIN=${smokeUrl.origin}\n`,
  );
  console.log(
    "Synthetic staging smoke accounts prepared with separate manual staff provisioning; no secrets logged.",
  );
} catch {
  console.error(
    "Synthetic staging smoke preparation failed; details withheld.",
  );
  process.exitCode = 1;
}
