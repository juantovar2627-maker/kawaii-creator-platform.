import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
const require = createRequire(import.meta.url);
require("tsx/cjs");
const {
  configurationIssues,
  trustedOrigin,
  uploadsEnabled,
  videosEnabled,
  signupEnabled,
} = require("../lib/config/runtime.ts");
const { siteGate, securityHeaders } = require("../lib/security/site-gate.ts");
const key = () => randomBytes(32).toString("hex");
const dev = () => ({
  NODE_ENV: "production",
  BASE_URL: "http://127.0.0.1:3000",
  POSTGRES_URL: "postgres://postgres:postgres@127.0.0.1:5432/mimi_test",
  AUTH_SECRET: key(),
  PAYMENTS_ENABLED: "false",
});
const stage = () => ({
  ...dev(),
  APP_ENV: "staging",
  BASE_URL: "https://staging.example.test",
  POSTGRES_URL:
    "postgres://test:fixture@database.example.test/mimi_staging?sslmode=verify-full",
  SESSION_COOKIE_SECURE: "true",
  TRUSTED_ORIGINS: "https://staging.example.test",
  TRUSTED_CLIENT_IP_HEADER: "x-mimi-client-ip",
  STAGING_ACCESS_USERNAME: "tester",
  STAGING_ACCESS_PASSWORD: key(),
  STAGING_DATA_ISOLATED: "true",
});
test("development builds need no Stripe/cloud/scanner credentials; remote defaults fail closed", () => {
  const env = dev();
  assert.deepEqual(configurationIssues(env), []);
  assert.equal(uploadsEnabled(env), true);
  assert.equal(signupEnabled(env), true);
  assert.ok(
    configurationIssues({
      ...env,
      BASE_URL: "https://public.example.test",
    }).includes("BASE_URL"),
  );
  for (const value of ["preview", "stagin", ""]) {
    if (value)
      assert.ok(
        configurationIssues({ ...env, APP_ENV: value }).includes("APP_ENV"),
      );
  }
  assert.ok(
    configurationIssues({ ...env, AUTH_SECRET: "short" }).includes(
      "AUTH_SECRET",
    ),
  );
  assert.ok(
    configurationIssues({ ...env, PAYMENTS_ENABLED: "true" }).includes(
      "PAYMENTS_ENABLED",
    ),
  );
});
test("staging requires HTTPS, verified database TLS, secure cookies, explicit origins and independent access secrets", () => {
  const env = stage();
  assert.deepEqual(configurationIssues(env), []);
  assert.equal(uploadsEnabled(env), false);
  assert.equal(videosEnabled(env), false);
  assert.equal(signupEnabled(env), false);
  for (const field of [
    "AUTH_SECRET",
    "POSTGRES_URL",
    "BASE_URL",
    "SESSION_COOKIE_SECURE",
    "TRUSTED_ORIGINS",
    "TRUSTED_CLIENT_IP_HEADER",
    "STAGING_ACCESS_PASSWORD",
    "STAGING_ACCESS_USERNAME",
    "STAGING_DATA_ISOLATED",
  ])
    assert.ok(
      configurationIssues({ ...env, [field]: undefined }).length,
      field,
    );
  for (const bad of [
    { BASE_URL: "http://staging.example.test" },
    {
      POSTGRES_URL:
        "postgres://test:fixture@db.example.test/staging?sslmode=require",
    },
    { SESSION_COOKIE_SECURE: "false" },
    { TRUSTED_ORIGINS: "*" },
    { STAGING_ACCESS_PASSWORD: env.AUTH_SECRET },
    { MEDIA_STORAGE_DRIVER: "local" },
    { MEDIA_SCAN_MODE: "development-manual" },
    { VIDEO_SANDBOX_MODE: "development-prlimit" },
  ])
    assert.ok(configurationIssues({ ...env, ...bad }).length);
  assert.equal(
    JSON.stringify(
      configurationIssues({
        ...env,
        POSTGRES_URL: "postgres://secret-password@bad",
        AUTH_SECRET: "bad",
      }),
    ).includes("secret-password"),
    false,
  );
});
test("upload/worker enablement requires storage, scanners and independent isolation verification; disabled modes remain usable", () => {
  const env = stage();
  assert.ok(
    configurationIssues({ ...env, MEDIA_UPLOADS_ENABLED: "true" }).includes(
      "MEDIA_STORAGE_DRIVER",
    ),
  );
  assert.ok(
    configurationIssues(
      { ...env, VIDEO_UPLOADS_ENABLED: "true", MEDIA_UPLOADS_ENABLED: "true" },
      "worker",
    ).includes("VIDEO_ISOLATION_VERIFICATION"),
  );
  assert.ok(
    configurationIssues({
      ...env,
      APP_ENV: "production",
      PAYMENTS_ENABLED: "true",
    }).includes("PAYMENTS_ENABLED"),
  );
  assert.deepEqual(configurationIssues({ ...env, APP_ENV: "production" }), []);
});
test("site gate is fail closed for every request regardless of path, cookies or spoofed middleware headers", () => {
  const env = stage(),
    h = new Headers({
      host: "staging.example.test",
      "x-forwarded-proto": "https",
    });
  assert.equal(siteGate(h, env).status, 401);
  h.set("cookie", "session=not-a-gate");
  h.set(
    "x-middleware-subrequest",
    "middleware:middleware:middleware:middleware:middleware",
  );
  assert.equal(siteGate(h, env).status, 401);
  h.set(
    "authorization",
    "Basic " + Buffer.from("tester:wrong").toString("base64"),
  );
  assert.equal(siteGate(h, env).status, 401);
  h.set(
    "authorization",
    "Basic " +
      Buffer.from("tester:" + env.STAGING_ACCESS_PASSWORD).toString("base64"),
  );
  assert.equal(siteGate(h, env), null);
  h.set("host", "evil.example.test");
  assert.equal(siteGate(h, env).status, 403);
  h.set("host", "staging.example.test");
  h.delete("x-forwarded-proto");
  assert.equal(siteGate(h, env).status, 403);
  assert.equal(
    siteGate(h, { ...env, STAGING_ACCESS_PASSWORD: undefined }).status,
    503,
  );
  assert.match(securityHeaders(env)["X-Robots-Tag"], /noindex/);
  assert.match(securityHeaders(env)["Cache-Control"], /no-store/);
  assert.equal(
    siteGate(new Headers({ host: "public.example.test" }), dev()).status,
    403,
  );
});
test("trusted origins reject cross-scheme, wildcard, hostile host and malformed origins", () => {
  const env = stage();
  assert.equal(trustedOrigin(env.BASE_URL, "staging.example.test", env), true);
  for (const origin of [
    "http://staging.example.test",
    "https://evil.example.test",
    "null",
    env.BASE_URL + "/",
    "https://staging.example.test@evil.example.test",
  ])
    assert.equal(trustedOrigin(origin, "staging.example.test", env), false);
  assert.equal(
    trustedOrigin("http://127.0.0.1:3001", "127.0.0.1:3001", dev()),
    true,
  );
});

test("background cleanup does not require web-session or site-gate secrets", () => {
  const env = stage();
  delete env.AUTH_SECRET;
  delete env.STAGING_ACCESS_PASSWORD;
  delete env.STAGING_ACCESS_USERNAME;
  delete env.TRUSTED_CLIENT_IP_HEADER;
  delete env.SESSION_COOKIE_SECURE;
  delete env.TRUSTED_ORIGINS;
  assert.deepEqual(configurationIssues(env, "cleanup"), []);
  assert.ok(configurationIssues(env, "app").length);
});
