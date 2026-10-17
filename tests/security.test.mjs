import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { SignJWT } from "jose";
const require = createRequire(import.meta.url);
const base = process.env.TEST_BASE_URL,
  url = process.env.TEST_DATABASE_URL,
  secret = process.env.AUTH_SECRET;
test(
  "authentication hardening: actions, persistent limits, revocation, deleted accounts and role boundaries",
  { skip: !base || !url || !secret },
  async (t) => {
    for (const value of [base, url])
      assert.ok(
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname),
      );
    const sql = postgres(url),
      ids = [],
      teams = [],
      tag = randomBytes(6).toString("hex"),
      email = `auth-${tag}@example.test`,
      password = randomBytes(18).toString("hex"),
      changed = randomBytes(18).toString("hex");
    const manifest = JSON.parse(
      await readFile(".next/server/server-reference-manifest.json", "utf8"),
    );
    const {
      encodeReply,
    } = require("next/dist/compiled/react-server-dom-webpack/client.node");
    const cookie = async (id, version = 0, extra = {}) =>
      "session=" +
      (await new SignJWT({
        user: { id },
        expires: new Date(Date.now() + 3600000).toISOString(),
        version,
        ...extra,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret)));
    const call = async (
      name,
      fields = {},
      session = "",
      origin = new URL(base).origin,
    ) => {
      const entry = Object.entries(manifest.node).find(
        ([, a]) => a.exportedName === name,
      );
      assert.ok(entry, name);
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
      const body = await encodeReply(name === "signOut" ? [] : [{}, form]);
      const headers = {
        "Next-Action": entry[0],
        Origin: origin,
        ...(session ? { Cookie: session } : {}),
      };
      if (typeof body === "string")
        headers["Content-Type"] = "text/plain;charset=UTF-8";
      const path =
        name === "signIn" || name === "signUp"
          ? "/sign-in"
          : "/dashboard/security";
      const response = await fetch(base + path, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      });
      return { response, text: await response.text() };
    };
    try {
      for (let i = 0; i < 2; i++) {
        const [u] =
          await sql`insert into users(name,email,password_hash) values('Security fixture',${i ? `member-${tag}@example.test` : email},${await hash(password, 10)}) returning id`;
        ids.push(u.id);
      }
      const owner = await cookie(ids[0]),
        member = await cookie(ids[1]);
      await t.test(
        "registration accepts empty optional invite fields and serializes case-insensitive duplicates",
        async () => {
          const address = `register-${tag}@example.test`;
          const results = await Promise.all(
            [address, address.toUpperCase()].map((email) =>
              call("signUp", {
                email,
                password,
                inviteId: "",
                redirect: "",
                priceId: "",
              }),
            ),
          );
          assert.deepEqual(
            results.map((r) => r.response.status).sort(),
            [200, 303],
          );
          const accounts =
            await sql`select id from users where lower(email)=${address}`;
          assert.equal(accounts.length, 1);
          ids.push(accounts[0].id);
          const [membership] =
            await sql`select team_id from team_members where user_id=${accounts[0].id}`;
          teams.push(membership.team_id);
          const invalid = `invite-${tag}@example.test`;
          const r = await call("signUp", {
            email: invalid,
            password,
            inviteId: "999999999",
          });
          assert.match(r.text, /Unable to register/);
          assert.equal(
            (await sql`select id from users where email=${invalid}`).length,
            0,
          );
        },
      );
      await t.test(
        "sessions reject malformed claims, revoked versions and deleted accounts without exposing internal fields",
        async () => {
          const r = await fetch(base + "/api/user", {
            headers: { Cookie: owner },
          });
          assert.equal(r.status, 200);
          const user = await r.json();
          assert.equal(user.id, ids[0]);
          assert.equal("passwordHash" in user, false);
          assert.equal("sessionVersion" in user, false);
          for (const session of [
            await cookie(ids[0], 10),
            await cookie(ids[0], 0, { expires: "not-a-date" }),
            await cookie("invalid"),
          ])
            assert.equal(
              await (
                await fetch(base + "/api/user", {
                  headers: { Cookie: session },
                })
              ).json(),
              null,
            );
        },
      );
      await t.test(
        "sign-in is case-insensitive, cookies are secure and errors never echo passwords",
        async () => {
          const valid = await call("signIn", {
            email: email.toUpperCase(),
            password,
          });
          assert.equal(valid.response.status, 303);
          assert.match(valid.response.headers.get("set-cookie"), /HttpOnly/i);
          assert.match(valid.response.headers.get("set-cookie"), /Secure/i);
          assert.match(
            valid.response.headers.get("set-cookie"),
            /SameSite=Lax/i,
          );
          const wrong = await call("signIn", { email, password: changed });
          assert.match(wrong.text, /Invalid email or password/);
          assert.equal(wrong.text.includes(changed), false);
          assert.equal(wrong.response.headers.get("set-cookie"), null);
        },
      );
      await t.test(
        "all authentication/account writes reject cross-origin requests",
        async () => {
          const bad = await call(
            "updateAccount",
            { name: "Unwanted change", email },
            owner,
            "https://evil.example.test",
          );
          assert.ok(
            bad.response.status >= 400 ||
              /must come from|Unable to continue/.test(bad.text),
          );
          assert.equal(
            (await sql`select name from users where id=${ids[0]}`)[0].name,
            "Security fixture",
          );
        },
      );
      await t.test(
        "password changes revoke old cookies and retain only a fresh current session",
        async () => {
          const result = await call(
            "updatePassword",
            {
              currentPassword: password,
              newPassword: changed,
              confirmPassword: changed,
            },
            owner,
          );
          assert.match(result.text, /Password updated successfully/);
          assert.equal(result.text.includes(changed), false);
          assert.equal(
            await (
              await fetch(base + "/api/user", { headers: { Cookie: owner } })
            ).json(),
            null,
          );
          const fresh = result.response.headers.get("set-cookie").split(";")[0];
          assert.equal(
            (
              await (
                await fetch(base + "/api/user", { headers: { Cookie: fresh } })
              ).json()
            ).id,
            ids[0],
          );
          await call("signOut", {}, fresh);
          assert.equal(
            await (
              await fetch(base + "/api/user", { headers: { Cookie: fresh } })
            ).json(),
            null,
          );
        },
      );
      await t.test(
        "team membership cannot grant platform staff or let members manage invitations",
        async () => {
          const [team] =
            await sql`insert into teams(name) values('Security fixture team') returning id`;
          teams.push(team.id);
          await sql`insert into team_members(user_id,team_id,role) values(${ids[0]},${team.id},'owner'),(${ids[1]},${team.id},'member')`;
          const denied = await call(
            "inviteTeamMember",
            { email: `invited-${tag}@example.test`, role: "owner" },
            member,
          );
          assert.match(denied.text, /Only the team owner/);
          assert.equal(
            (await sql`select id from invitations where team_id=${team.id}`)
              .length,
            0,
          );
          assert.equal(
            (
              await fetch(base + "/api/admin/health", {
                headers: { Cookie: member },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await fetch(base + "/api/admin/moderation", {
                headers: { Cookie: member },
              })
            ).status,
            403,
          );
        },
      );
      await t.test(
        "fixed authentication windows persist across requests and store only HMAC subjects",
        async () => {
          const target = `abuse-${tag}@example.test`;
          for (let i = 0; i < 10; i++) {
            const r = await call("signIn", { email: target, password });
            assert.match(r.text, /Invalid email or password/);
          }
          const limited = await call("signIn", { email: target, password });
          assert.match(limited.text, /Please wait/);
          const subject = createHmac("sha256", secret)
            .update("signin_email:" + target)
            .digest("hex");
          const [row] =
            await sql`select * from auth_rate_limits where scope='signin_email' and subject_hash=${subject}`;
          assert.equal(row.attempts, 11);
          assert.equal(JSON.stringify(row).includes(target), false);
        },
      );
      await t.test(
        "account deletion invalidates sessions and cannot authenticate again",
        async () => {
          const current = await cookie(ids[0], 2);
          const r = await call("deleteAccount", { password: changed }, current);
          assert.equal(r.response.status, 303);
          assert.ok(
            (await sql`select deleted_at from users where id=${ids[0]}`)[0]
              .deleted_at,
          );
          assert.equal(
            await (
              await fetch(base + "/api/user", { headers: { Cookie: current } })
            ).json(),
            null,
          );
          const deleted = await call("signIn", { email, password: changed });
          assert.match(deleted.text, /Invalid email or password/);
          assert.equal(deleted.response.headers.get("set-cookie"), null);
        },
      );
    } finally {
      const subjects = [];
      for (const [scope, values] of [
        ["signin_email", [email, `abuse-${tag}@example.test`]],
        ["account", ids.map(String)],
        [
          "signup_email",
          [`register-${tag}@example.test`, `invite-${tag}@example.test`],
        ],
      ])
        for (const value of values)
          subjects.push(
            createHmac("sha256", secret)
              .update(scope + ":" + value)
              .digest("hex"),
          );
      await sql.begin(async (tx) => {
        await tx`delete from activity_logs where user_id=any(${ids}::int[])`;
        await tx`delete from invitations where team_id=any(${teams}::int[])`;
        await tx`delete from team_members where user_id=any(${ids}::int[])`;
        await tx`delete from teams where id=any(${teams}::int[])`;
        await tx`delete from auth_rate_limits where subject_hash=any(${subjects}::text[])`;
        await tx`delete from users where id=any(${ids}::int[])`;
      });
      await sql.end();
    }
  },
);
