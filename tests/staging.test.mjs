import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { SignJWT } from "jose";
const base = process.env.TEST_STAGING_BASE_URL,
  file = process.env.TEST_STAGING_ENV_FILE;
test(
  "private staging: full-site gate, disabled intake, staff diagnostics and isolated data",
  { skip: !base || !file },
  async (t) => {
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
    );
    const env = parse(await readFile(file));
    assert.equal(env.APP_ENV, "staging");
    assert.notEqual(env.POSTGRES_URL, process.env.TEST_DATABASE_URL);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(env.POSTGRES_URL).hostname,
      ),
    );
    const sql = postgres(env.TEST_ADMIN_POSTGRES_URL || env.POSTGRES_URL),
      ids = [],
      tag = randomBytes(6).toString("hex");
    const basic =
      "Basic " +
      Buffer.from(
        env.STAGING_ACCESS_USERNAME + ":" + env.STAGING_ACCESS_PASSWORD,
      ).toString("base64");
    const h = {
      Authorization: basic,
      "X-Forwarded-Proto": "https",
      "X-Mimi-Client-IP": "127.0.0.1",
    };
    const request = (path, headers = {}, options = {}) =>
      fetch(base + path, {
        redirect: "manual",
        ...options,
        headers: { ...h, ...headers },
      });
    const cookie = async (id) =>
      "session=" +
      (await new SignJWT({
        user: { id },
        expires: new Date(Date.now() + 3600000).toISOString(),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(env.AUTH_SECRET)));
    try {
      for (let i = 0; i < 2; i++) {
        const [u] =
          await sql`insert into users(name,email,password_hash) values('Staging fixture',${`stage-${i}-${tag}@example.test`},${await hash(randomBytes(18).toString("hex"), 10)}) returning id`;
        ids.push(u.id);
      }
      const member = await cookie(ids[0]),
        staff = await cookie(ids[1]);
      await sql`insert into platform_staff(user_id,role,active) values(${ids[1]},'moderator',true)`;
      await t.test(
        "hosted startup rejects invalid settings and owner credentials without logging secret values",
        async () => {
          for (const bad of [
            {
              AUTH_SECRET: "private-invalid-auth-marker",
              POSTGRES_URL: "postgres://private-credential-marker@bad",
            },
            { POSTGRES_URL: env.TEST_ADMIN_POSTGRES_URL },
          ]) {
            assert.ok(bad.POSTGRES_URL);
            await assert.rejects(
              () =>
                promisify(execFile)(
                  process.execPath,
                  [
                    "--conditions=react-server",
                    "--import",
                    "tsx",
                    "scripts/start.ts",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    "0",
                  ],
                  { env: { ...process.env, ...env, ...bad }, timeout: 15000 },
                ),
              (error) => {
                const output = String(error.stdout) + String(error.stderr);
                assert.ok(
                  !error.killed,
                  "The server must exit, not hang until timeout.",
                );
                assert.match(
                  output,
                  /Invalid runtime configuration|database security verification failed/,
                );
                assert.equal(
                  output.includes("private-invalid-auth-marker"),
                  false,
                );
                assert.equal(
                  output.includes("private-credential-marker"),
                  false,
                );
                return true;
              },
            );
          }
        },
      );
      await t.test(
        "every page, static file, API, media and binary upload rejects absent/incorrect tester authorization",
        async () => {
          for (const path of [
            "/",
            "/sign-in",
            "/sign-up",
            "/robots.txt",
            "/icon.svg",
            "/images/mimi-hero.png",
            "/_next/static/unknown.js",
            "/api/health",
            "/api/user",
            "/api/admin/health",
            "/api/unknown",
            "/api/media/" + randomUUID(),
            "/api/videos/" + randomUUID(),
          ]) {
            const r = await request(path, {
              Authorization: "",
              Cookie: member,
              "X-Middleware-Subrequest":
                "middleware:middleware:middleware:middleware:middleware",
            });
            assert.equal(r.status, 401, path);
            assert.match(r.headers.get("x-robots-tag"), /noindex/);
            assert.match(r.headers.get("cache-control"), /no-store/);
          }
          for (const kind of ["media", "videos"]) {
            const r = await request(
              "/api/" + kind + "/" + randomUUID() + "/upload",
              { Authorization: "" },
              { method: "PUT", body: "synthetic" },
            );
            assert.equal(r.status, 401);
          }
          assert.equal(
            (
              await request("/api/health", {
                Authorization:
                  "Basic " + Buffer.from("tester:wrong").toString("base64"),
              })
            ).status,
            401,
          );
          assert.equal(
            (await request("/api/health", { "X-Forwarded-Proto": "http" }))
              .status,
            403,
          );
        },
      );
      await t.test(
        "authorized staging shows indicators and noindex; liveness reveals no diagnostics",
        async () => {
          const r = await request("/api/health");
          assert.equal(r.status, 200);
          assert.deepEqual(await r.json(), { status: "ok" });
          const signup = await request("/sign-up");
          const html = await signup.text();
          assert.equal(signup.status, 200);
          assert.match(html, /Private staging/);
          assert.match(html, /Registration is unavailable/);
          assert.equal(html.includes(env.AUTH_SECRET), false);
          assert.equal(html.includes(env.STAGING_ACCESS_PASSWORD), false);
          assert.match(
            await (await request("/robots.txt")).text(),
            /Disallow: \//,
          );
        },
      );
      await t.test(
        "server actions cannot bypass disabled registration; payment/media endpoints stay closed",
        async () => {
          const require = createRequire(import.meta.url),
            {
              encodeReply,
            } = require("next/dist/compiled/react-server-dom-webpack/client.node");
          const manifest = JSON.parse(
            await readFile(
              ".next/server/server-reference-manifest.json",
              "utf8",
            ),
          );
          const [id] = Object.entries(manifest.node).find(
            ([, a]) => a.exportedName === "signUp",
          );
          const form = new FormData();
          form.set("email", `closed-${tag}@example.test`);
          form.set("password", randomBytes(18).toString("hex"));
          const body = await encodeReply([{}, form]);
          const r = await request(
            "/sign-up",
            {
              "Next-Action": id,
              Origin: env.BASE_URL,
              ...(typeof body === "string"
                ? { "Content-Type": "text/plain;charset=UTF-8" }
                : {}),
            },
            { method: "POST", body },
          );
          assert.match(await r.text(), /Registration is unavailable/);
          assert.equal(
            (
              await sql`select id from users where email=${`closed-${tag}@example.test`}`
            ).length,
            0,
          );
          for (const path of ["/api/media", "/api/videos"]) {
            const r = await request(
              path,
              {
                Cookie: member,
                Origin: env.BASE_URL,
                "Content-Type": "application/json",
              },
              {
                method: "POST",
                body: JSON.stringify({
                  action: "reserve",
                  postId: 1,
                  revision: 1,
                  ...(path === "/api/videos" ? { bytes: 10 } : {}),
                  description: "Synthetic",
                }),
              },
            );
            assert.equal(r.status, 503);
          }
          assert.equal((await request("/api/stripe/checkout")).status, 503);
          assert.equal(
            (
              await request(
                "/api/stripe/webhook",
                {},
                { method: "POST", body: "synthetic" },
              )
            ).status,
            503,
          );
        },
      );
      await t.test(
        "moderation still works while staff permissions remain read-only to the app",
        async () => {
          const [profile] =
            await sql`insert into creator_profiles(user_id,username,display_name,biography,theme,avatar,banner,categories,visibility) values(${ids[0]},${"stage_" + tag},'Staging artist','Synthetic staging profile.','pink','star','blossom','["Art & illustration"]'::jsonb,'listed') returning id,revision`;
          const response = await request(
            "/api/admin/moderation",
            {
              Cookie: staff,
              Origin: env.BASE_URL,
              "Content-Type": "application/json",
            },
            {
              method: "POST",
              body: JSON.stringify({
                action: "approve",
                profileId: profile.id,
                revision: profile.revision,
                reason:
                  "Suitable synthetic profile for a staging verification.",
                internalNote: "",
              }),
            },
          );
          assert.equal(response.status, 200, await response.text());
          assert.equal(
            (
              await sql`select moderation_status from creator_profiles where id=${profile.id}`
            )[0].moderation_status,
            "approved",
          );
        },
      );
      await t.test(
        "readiness is restricted, verifies database TLS and exposes only bounded operational diagnostics",
        async () => {
          for (const headers of [
            {},
            { Cookie: member },
            { "X-Mimi-Health-Token": "incorrect" },
          ])
            assert.equal(
              (await request("/api/admin/health", headers)).status,
              403,
            );
          const r = await request("/api/admin/health", { Cookie: staff });
          assert.equal(r.status, 200);
          const result = await r.json();
          assert.equal(result.ready, true);
          assert.equal(result.environment, "staging");
          assert.equal(result.checks.database.status, "ready");
          assert.equal(result.checks.databaseRole.status, "ready");
          assert.equal(result.checks.storage.status, "disabled");
          const internal = await request("/api/admin/health", {
            "X-Mimi-Health-Token": env.HEALTHCHECK_TOKEN,
          });
          assert.equal(internal.status, 200);
          const text = JSON.stringify(result);
          for (const value of [
            env.AUTH_SECRET,
            env.HEALTHCHECK_TOKEN,
            env.POSTGRES_URL,
            `stage-0-${tag}@example.test`,
          ])
            assert.equal(text.includes(value), false);
          assert.equal(
            (
              await sql`select ssl from pg_stat_ssl where pid=pg_backend_pid()`
            )[0].ssl,
            true,
          );
          await sql`update platform_staff set active=false where user_id=${ids[1]}`;
          assert.equal(
            (await request("/api/admin/health", { Cookie: staff })).status,
            403,
          );
        },
      );
      await t.test(
        "application credentials cannot grant staff, rewrite audit or create schema objects",
        async () => {
          const app = postgres(env.POSTGRES_URL);
          try {
            await assert.rejects(
              () => app`update platform_staff set active=true where false`,
              (e) => e.code === "42501",
            );
            await assert.rejects(
              () =>
                app`update moderation_audit set reason='forbidden' where false`,
              (e) => e.code === "42501",
            );
            await assert.rejects(
              () =>
                app.unsafe(
                  "CREATE TABLE public.forbidden_staging_fixture(id int)",
                ),
              (e) => e.code === "42501",
            );
          } finally {
            await app.end();
          }
        },
      );
    } finally {
      try {
        await sql`delete from safety_rate_limits where user_id=any(${ids}::int[])`;
        await sql`delete from moderation_audit where actor_id=any(${ids}::int[]) or profile_id in(select id from creator_profiles where user_id=any(${ids}::int[]))`;
        await sql`delete from creator_profiles where user_id=any(${ids}::int[])`;
        await sql`delete from platform_staff where user_id=any(${ids}::int[])`;
        await sql`delete from users where id=any(${ids}::int[])`;
      } finally {
        await sql.end();
      }
    }
  },
);
