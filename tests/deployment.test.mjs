import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
const run = promisify(execFile);
test("container readiness probe preserves private gate and fails on unhealthy or denied responses", async () => {
  const access = randomBytes(32).toString("hex"),
    health = randomBytes(32).toString("hex");
  let status = 200,
    ready = true,
    seen;
  const server = createServer((req, res) => {
    seen = req;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ready }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = {
      ...process.env,
      PORT: String(server.address().port),
      BASE_URL: "https://private.example.test",
      STAGING_ACCESS_USERNAME: "tester",
      STAGING_ACCESS_PASSWORD: access,
      HEALTHCHECK_TOKEN: health,
    };
    const result = await run(
      process.execPath,
      ["scripts/container-health.mjs"],
      { env },
    );
    assert.equal(result.stdout + result.stderr, "");
    assert.equal(seen.url, "/api/admin/health");
    assert.equal(seen.headers.host, "private.example.test");
    assert.equal(
      seen.headers.authorization,
      "Basic " + Buffer.from("tester:" + access).toString("base64"),
    );
    assert.equal(seen.headers["x-mimi-health-token"], health);
    assert.equal(seen.headers["x-forwarded-proto"], "https");
    for (const state of [
      { status: 200, ready: false },
      { status: 403, ready: true },
      { status: 503, ready: false },
    ]) {
      ({ status, ready } = state);
      await assert.rejects(
        () => run(process.execPath, ["scripts/container-health.mjs"], { env }),
        (error) =>
          error.code === 1 &&
          !(String(error.stdout) + String(error.stderr)).includes(access),
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("offline staging operator refuses unverified or ambiguous database settings without leaking URLs", async () => {
  const marker = "private-password-" + randomBytes(8).toString("hex");
  for (const url of [
    `postgres://operator:${marker}@127.0.0.1/mimi_staging`,
    `postgres://operator:${marker}@127.0.0.1/production?sslmode=verify-full`,
  ]) {
    await assert.rejects(
      () =>
        run(
          process.execPath,
          ["scripts/staging-operator.mjs", "--command", "verify"],
          {
            env: {
              ...process.env,
              APP_ENV: "staging",
              STAGING_DATA_ISOLATED: "true",
              STAGING_DATABASE_NAME: "mimi_staging",
              POSTGRES_URL: url,
            },
            timeout: 10000,
          },
        ),
      (error) =>
        error.code === 1 &&
        !String(error.stdout + error.stderr).includes(marker),
    );
  }
});
test(
  "offline staging verifier accepts TLS app credentials and rejects operator credentials",
  { skip: !process.env.TEST_STAGING_ENV_FILE },
  async () => {
    const fixture = parse(await readFile(process.env.TEST_STAGING_ENV_FILE));
    const u = new URL(fixture.POSTGRES_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(u.hostname));
    const env = {
      ...process.env,
      ...fixture,
      STAGING_DATABASE_NAME: u.pathname.slice(1),
    };
    const result = await run(
      process.execPath,
      ["scripts/staging-operator.mjs", "--command", "verify"],
      { env },
    );
    assert.match(result.stdout, /PASS: verified database TLS/);
    await assert.rejects(
      () =>
        run(
          process.execPath,
          ["scripts/staging-operator.mjs", "--command", "verify"],
          { env: { ...env, POSTGRES_URL: fixture.TEST_ADMIN_POSTGRES_URL } },
        ),
      (error) =>
        error.code === 1 &&
        !String(error.stdout + error.stderr).includes(
          fixture.TEST_ADMIN_POSTGRES_URL,
        ),
    );
  },
);
