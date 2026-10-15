import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { SignJWT } from "jose";
import { hash } from "bcryptjs";
import { creators } from "../lib/demo/community.ts";

// Explicit test DB opt-in. Never implicitly connect to a deployment database.
const base = process.env.TEST_BASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const authSecret = process.env.AUTH_SECRET;
const enabled = Boolean(base && databaseUrl && authSecret);

test(
  "real creator profiles: two accounts, authorization, privacy, visibility, validation, and concurrency",
  { skip: !enabled },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
      "Use a local test server",
    );
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(databaseUrl).hostname,
      ),
      "Use a development database",
    );
    const sql = postgres(databaseUrl, { max: 2 });
    const tag = randomBytes(6).toString("hex");
    const nameA = `testa_${tag}`;
    const nameB = `testb_${tag}`;
    const ids = [];
    let cookieA, cookieB;
    const input = (username, more = {}) => ({
      username,
      displayName: "A little test creator",
      biography: "Fashion, art, and kind little moments.",
      categories: ["Art & illustration"],
      communityAccepted: true,
      ...more,
    });
    const request = async (method, payload, cookie, extraHeaders = {}) =>
      fetch(new URL("/api/creator-profile", base), {
        method,
        headers: {
          Origin: new URL(base).origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...extraHeaders,
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        redirect: "manual",
      });
    const page = (path) => fetch(new URL(path, base), { redirect: "manual" });
    const stored = async (id) =>
      (await sql`select * from creator_profiles where user_id=${id}`)[0];
    const directory = async () => await (await page("/discover")).text();
    try {
      const passwordHash = await hash(randomBytes(24).toString("hex"), 10);
      for (const label of ["a", "b"]) {
        const [user] =
          await sql`insert into users (email, password_hash, name) values (${`creator-${label}-${tag}@example.test`}, ${passwordHash}, ${`Private name ${label} ${tag}`}) returning id`;
        ids.push(user.id);
      }
      const cookie = async (id) =>
        "session=" +
        (await new SignJWT({
          user: { id },
          expires: new Date(Date.now() + 3600000).toISOString(),
        })
          .setProtectedHeader({ alg: "HS256" })
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode(authSecret)));
      [cookieA, cookieB] = await Promise.all(ids.map(cookie));

      await t.test(
        "authentication and same-origin protection precede mutations",
        async () => {
          assert.equal((await request("POST", input(nameA))).status, 401);
          assert.equal((await request("GET")).status, 401);
          assert.equal(
            (await request("POST", input(nameA), "session=invalid")).status,
            401,
          );
          assert.equal(
            (
              await request("POST", input(nameA), cookieA, {
                Origin: "https://other.example",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from creator_profiles where user_id in ${sql(ids)}`
            )[0].n,
            0,
          );
        },
      );
      await t.test(
        "creates one normalized, unlisted profile without account data",
        async () => {
          const response = await request(
            "POST",
            input(`  ${nameA.toUpperCase()}  `),
            cookieA,
          );
          assert.equal(response.status, 201);
          const { profile } = await response.json();
          assert.equal(profile.username, nameA);
          assert.equal(profile.visibility, "unlisted");
          assert.equal(profile.moderationStatus, "pending");
          assert.ok(profile.createdAt && profile.updatedAt);
          for (const field of [
            "email",
            "passwordHash",
            "password_hash",
            "userId",
            "user_id",
            "id",
            "role",
          ])
            assert.equal(field in profile, false);
          assert.equal(
            (await request("POST", input(`another_${tag}`), cookieA)).status,
            409,
          );
          assert.equal((await page(`/creators/${nameA}`)).status, 200);
          assert.equal(
            (await page(`/creators/${nameA.toUpperCase()}`)).status,
            200,
          );
          assert.ok(!(await directory()).includes(nameA));
        },
      );
      await t.test(
        "duplicate and reserved usernames are rejected case-insensitively",
        async () => {
          assert.equal(
            (await request("POST", input(nameA.toUpperCase()), cookieB)).status,
            409,
          );
          for (const username of [
            "AdMiN",
            "YukiBloom",
            "has space",
            "a",
            "a".repeat(31),
          ])
            assert.equal(
              (await request("POST", input(username), cookieB)).status,
              400,
              username,
            );
          // Also exercise the database invariant directly, bypassing application validation.
          await assert.rejects(
            sql`insert into creator_profiles (user_id,username,display_name,categories) values (${ids[1]},${nameA},'duplicate','["Cosplay"]'::jsonb)`,
            (error) => error.code === "23505",
          );
        },
      );
      await t.test(
        "another account cannot address or edit the first profile",
        async () => {
          assert.equal(
            (
              await request(
                "PATCH",
                input(nameA, { biography: "Hijacked" }),
                cookieB,
              )
            ).status,
            404,
          );
          const own = await request("GET", undefined, cookieB);
          assert.deepEqual(await own.json(), { profile: null });
          assert.equal(
            (await request("PATCH", input(nameA, { userId: ids[0] }), cookieB))
              .status,
            400,
          );
          assert.equal(
            (await stored(ids[0])).biography,
            "Fashion, art, and kind little moments.",
          );
          assert.equal(
            (await request("POST", input(nameB), cookieB)).status,
            201,
          );
          assert.equal(
            (
              await request(
                "PATCH",
                input(nameB, { biography: "Only account B changed." }),
                cookieB,
              )
            ).status,
            200,
          );
          assert.equal((await stored(ids[0])).username, nameA);
          assert.equal(
            (await stored(ids[1])).biography,
            "Only account B changed.",
          );
          assert.equal(
            (await request("PATCH", input(nameA), cookieB)).status,
            409,
          );
        },
      );
      await t.test(
        "concurrent username claims have exactly one winner",
        async () => {
          const claim = `race_${tag}`;
          const responses = await Promise.all([
            request("PATCH", input(claim), cookieA),
            request("PATCH", input(claim.toUpperCase()), cookieB),
          ]);
          assert.deepEqual(
            responses.map((response) => response.status).sort(),
            [200, 409],
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from creator_profiles where username=${claim}`
            )[0].n,
            1,
          );
          assert.equal(
            (await request("PATCH", input(nameA), cookieA)).status,
            200,
          );
          assert.equal(
            (await request("PATCH", input(nameB), cookieB)).status,
            200,
          );
        },
      );
      await t.test(
        "validation blocks privileged fields, unsafe links, invalid presets, and oversized input",
        async () => {
          for (const more of [
            { websiteUrl: "javascript:alert(1)" },
            { websiteUrl: "data:text/html,evil" },
            { websiteUrl: "https://user:pass@example.com" },
            { websiteUrl: "https://127.0.0.1" },
            { instagramUrl: "https://evil.example/path" },
            { youtubeUrl: "http://youtube.com/" },
            { theme: "url(evil)" },
            { biography: "x".repeat(1001) },
            { categories: [] },
            { communityAccepted: false },
            { moderationStatus: "approved" },
            { visibility: "anything" },
          ])
            assert.equal(
              (await request("PATCH", input(nameA, more), cookieA)).status,
              400,
              JSON.stringify(more).slice(0, 100),
            );
          const response = await request(
            "PATCH",
            input(nameA, { biography: "x".repeat(9000) }),
            cookieA,
          );
          assert.equal(response.status, 400);
        },
      );
      // Reset only these fixtures' rate windows to isolate security cases from visibility cases.
      await sql`delete from creator_mutation_limits where user_id in ${sql(ids)}`;
      await t.test(
        "updates persist, text is escaped, and public pages do not leak private fields",
        async () => {
          const response = await request(
            "PATCH",
            input(nameA, {
              displayName: '<script>alert("test")</script>',
              biography: "<img src=x onerror=alert(1)>",
              websiteUrl: "https://example.com/art",
              theme: "lavender",
              avatar: "bow",
              banner: "daydream",
            }),
            cookieA,
          );
          assert.equal(response.status, 200);
          const row = await stored(ids[0]);
          assert.equal(row.theme, "lavender");
          assert.ok(row.updated_at > row.created_at);
          const publicPage = await page(`/creators/${nameA}`);
          assert.equal(publicPage.status, 200);
          assert.match(
            publicPage.headers.get("cache-control"),
            /no-store|no-cache/,
          );
          const html = await publicPage.text();
          assert.match(html, /&lt;script&gt;/);
          assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
          assert.match(html, /nofollow ugc noopener noreferrer/);
          assert.match(html, /noindex/);
          for (const forbidden of [
            `creator-a-${tag}@example.test`,
            `Private name a ${tag}`,
            passwordHash,
            "passwordHash",
            "communityAcceptedAt",
            "userId",
            "stripeCustomerId",
          ])
            assert.ok(!html.includes(forbidden), forbidden);
        },
      );
      await t.test(
        "discovery requires approval and edits revoke approval",
        async () => {
          assert.equal(
            (
              await request(
                "PATCH",
                input(nameA, { visibility: "listed" }),
                cookieA,
              )
            ).status,
            200,
          );
          assert.ok(
            !(await directory()).includes(nameA),
            "Pending profiles stay out of discovery",
          );
          // No moderation endpoint is exposed: simulate an approval for a disposable fixture only.
          await sql`update creator_profiles set moderation_status='approved' where user_id=${ids[0]}`;
          assert.ok((await directory()).includes(nameA));
          assert.ok(
            !(await directory()).includes(nameB),
            "Unlisted real account stays out",
          );
          assert.equal(
            (
              await request(
                "PATCH",
                input(nameA, {
                  visibility: "listed",
                  biography: "Edited after review",
                }),
                cookieA,
              )
            ).status,
            200,
          );
          assert.equal((await stored(ids[0])).moderation_status, "pending");
          assert.ok(!(await directory()).includes(nameA));
        },
      );
      await t.test(
        "hidden, suspended, deleted, and unknown accounts return actual HTTP 404",
        async () => {
          assert.equal(
            (
              await request(
                "PATCH",
                input(nameA, { visibility: "hidden" }),
                cookieA,
              )
            ).status,
            200,
          );
          assert.equal((await page(`/creators/${nameA}`)).status, 404);
          const ownerPage = await fetch(new URL(`/creators/${nameA}`, base), {
            headers: { Cookie: cookieA },
          });
          assert.equal(
            ownerPage.status,
            404,
            "Only the authenticated preview route bypasses visibility",
          );
          assert.equal(
            (
              await fetch(new URL("/dashboard/creator-space/preview", base), {
                headers: { Cookie: cookieA },
              })
            ).status,
            200,
          );
          assert.equal(
            (await request("PATCH", input(nameA), cookieA)).status,
            200,
          );
          assert.equal((await page(`/creators/${nameA}`)).status, 200);
          await sql`update creator_profiles set moderation_status='suspended' where user_id=${ids[0]}`;
          assert.equal((await page(`/creators/${nameA}`)).status, 404);
          assert.equal(
            (await request("PATCH", input(nameA), cookieA)).status,
            200,
          );
          assert.equal((await stored(ids[0])).moderation_status, "suspended");
          assert.equal((await page(`/creators/${nameA}`)).status, 404);
          await sql`update users set deleted_at=now() where id=${ids[1]}`;
          assert.equal((await page(`/creators/${nameB}`)).status, 404);
          assert.equal((await request("GET", undefined, cookieB)).status, 401);
          assert.equal((await page(`/creators/unknown_${tag}`)).status, 404);
          assert.equal((await page("/creators/invalid-name")).status, 404);
        },
      );
      await t.test(
        "persistent rate limits reject concurrent excess attempts",
        async () => {
          await sql`delete from creator_mutation_limits where user_id=${ids[0]}`;
          const responses = await Promise.all(
            Array.from({ length: 25 }, () =>
              request("PATCH", { invalid: true }, cookieA),
            ),
          );
          assert.equal(
            responses.filter((response) => response.status === 400).length,
            20,
          );
          assert.equal(
            responses.filter((response) => response.status === 429).length,
            5,
          );
          assert.equal(
            responses
              .find((response) => response.status === 429)
              .headers.get("retry-after"),
            "60",
          );
          await sql`update creator_mutation_limits set window_started_at=now() - interval '2 minutes' where user_id=${ids[0]}`;
          assert.equal(
            (await request("PATCH", { invalid: true }, cookieA)).status,
            400,
          );
        },
      );
      await t.test(
        "all six fictional routes and payment-disabled pages are preserved",
        async () => {
          assert.equal(creators.length, 6);
          for (const demo of creators) {
            const response = await page(`/creators/${demo.username}`);
            assert.equal(response.status, 200);
            const html = await response.text();
            assert.match(html, /Fictional creator profile/);
            assert.match(html, /Payments are unavailable/);
          }
        },
      );
    } finally {
      if (ids.length)
        await sql.begin(async (tx) => {
          await tx`delete from creator_mutation_limits where user_id in ${tx(ids)}`;
          await tx`delete from creator_profiles where user_id in ${tx(ids)}`;
          await tx`delete from users where id in ${tx(ids)}`;
        });
      await sql.end();
    }
  },
);
