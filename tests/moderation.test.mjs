import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { SignJWT } from "jose";
import { hash } from "bcryptjs";

const base = process.env.TEST_BASE_URL,
  databaseUrl = process.env.TEST_DATABASE_URL,
  secret = process.env.AUTH_SECRET;
test(
  "community moderation: independent members, provisioned staff, privacy, enforcement, and persistence",
  { skip: !base || !databaseUrl || !secret },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
    );
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(databaseUrl).hostname,
      ),
    );
    const sql = postgres(databaseUrl, { max: 3 });
    const tag = randomBytes(6).toString("hex");
    const ids = [];
    const names = [`safety_a_${tag}`, `safety_b_${tag}`, `staff_${tag}`];
    const cookies = [];
    const token = async (id) =>
      "session=" +
      (await new SignJWT({
        user: { id },
        expires: new Date(Date.now() + 3600000).toISOString(),
        role: "admin",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret)));
    const call = (path, method = "GET", body, cookie, headers = {}) =>
      fetch(new URL(path, base), {
        method,
        headers: {
          Origin: new URL(base).origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
      });
    const safety = (body, member = 0, headers = {}) =>
      call("/api/safety", "POST", body, cookies[member], headers);
    const admin = (body, member = 2, headers = {}) =>
      call("/api/admin/moderation", "POST", body, cookies[member], headers);
    const queue = (query, member = 2) =>
      call("/api/admin/moderation?" + query, "GET", undefined, cookies[member]);
    const own = async (member = 0, cookie = cookies[member]) =>
      (await call("/api/safety", "GET", undefined, cookie)).json();
    const profileInput = (username, more = {}) => ({
      username,
      displayName: "Safety fixture " + tag,
      biography: "Respectful art and community.",
      categories: ["Art & illustration"],
      visibility: "listed",
      communityAccepted: true,
      ...more,
    });
    const edit = (member, more = {}) =>
      call(
        "/api/creator-profile",
        "PATCH",
        profileInput(names[member], more),
        cookies[member],
      );
    const creator = async (member) =>
      (
        await sql`select * from creator_profiles where user_id=${ids[member]}`
      )[0];
    const decision = async (action, member = 0, as = 2, more = {}) => {
      const row = await creator(member);
      return admin(
        {
          action,
          profileId: row.id,
          revision: row.revision,
          reason: "A clear creator-visible explanation for this decision.",
          internalNote: "staff-only-note-" + tag,
          ...more,
        },
        as,
      );
    };
    const provision = (index, action, role) =>
      execFileSync(
        process.execPath,
        [
          "scripts/platform-staff.mjs",
          "--action",
          action,
          "--user-id",
          String(ids[index]),
          "--role",
          role,
          "--operator",
          "automated-development-fixture",
          "--reason",
          "Provision disposable moderation test account.",
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, POSTGRES_URL: databaseUrl },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    let reportId, blockId, rejectedId, appealId;
    try {
      const passwordHash = await hash(randomBytes(20).toString("hex"), 10);
      for (let i = 0; i < 4; i++) {
        const [row] =
          await sql`insert into users(email,password_hash,role) values (${`safety-${i}-${tag}@example.test`},${passwordHash},'owner') returning id`;
        ids.push(row.id);
        cookies.push(await token(row.id));
      }
      await t.test(
        "normal SaaS owners and role claims grant no platform authority",
        async () => {
          for (const cookie of [
            undefined,
            cookies[0],
            cookies[2],
            "session=bad",
          ]) {
            assert.equal(
              (await call("/admin/moderation", "GET", undefined, cookie))
                .status,
              403,
            );
            assert.equal(
              (await call("/api/admin/moderation", "GET", undefined, cookie))
                .status,
              403,
            );
          }
          assert.equal(
            (await admin({ action: "grant", userId: ids[0], role: "admin" }, 0))
              .status,
            403,
          );
          assert.equal(
            (await safety({ action: "grant", role: "admin" })).status,
            400,
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from platform_staff where user_id in ${sql(ids)}`
            )[0].n,
            0,
          );
        },
      );
      await t.test(
        "manual provisioning is audited and protects the last administrator",
        async () => {
          assert.match(provision(3, "grant", "admin"), /audit record saved/);
          assert.match(
            provision(2, "grant", "moderator"),
            /audit record saved/,
          );
          const [{ n: otherAdmins }] =
            await sql`select count(*)::int as n from platform_staff s join users u on u.id=s.user_id where s.active and s.role='admin' and u.deleted_at is null and s.user_id<>${ids[3]}`;
          if (!otherAdmins)
            assert.throws(
              () => provision(3, "revoke", "admin"),
              (error) => String(error.stderr).includes("last one"),
            );
          assert.equal(
            (await queue("kind=profiles&status=pending")).status,
            200,
          );
          assert.equal(
            (await call("/admin/moderation", "GET", undefined, cookies[2]))
              .status,
            200,
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from moderation_audit where entity_type='permission' and entity_id in ${sql(ids)}`
            )[0].n,
            2,
          );
        },
      );
      for (let i = 0; i < 3; i++)
        assert.equal(
          (
            await call(
              "/api/creator-profile",
              "POST",
              profileInput(names[i]),
              cookies[i],
            )
          ).status,
          201,
        );
      await t.test(
        "every staff mutation is authorized, CSRF-protected, and strictly validated",
        async () => {
          const row = await creator(0);
          const body = {
            action: "approve",
            profileId: row.id,
            revision: row.revision,
            reason: "A valid review explanation.",
          };
          assert.equal((await admin(body, 0)).status, 403);
          assert.equal(
            (await admin(body, 2, { Origin: "https://other.example" })).status,
            403,
          );
          assert.equal((await admin(body, 2, { Origin: "" })).status, 403);
          assert.equal((await admin({ ...body, role: "admin" })).status, 400);
          assert.equal(
            (await decision("approve", 2)).status,
            403,
            "Staff cannot approve their own creator profile",
          );
          assert.equal(
            (await queue("kind=profiles&status=pending&page=0")).status,
            400,
          );
          assert.equal(
            (
              await safety({ action: "block", username: names[1] }, 0, {
                Origin: "https://other.example",
              })
            ).status,
            403,
          );
        },
      );
      await t.test(
        "stale approval is rejected and current approval controls discovery",
        async () => {
          const old = await creator(0);
          assert.equal(
            (
              await edit(0, {
                biography: "Edited after staff opened the review.",
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await admin({
                action: "approve",
                profileId: old.id,
                revision: old.revision,
                reason: "Old review must not approve new content.",
              })
            ).status,
            409,
          );
          assert.equal((await decision("approve")).status, 200);
          assert.match(
            await (await call("/discover")).text(),
            new RegExp(names[0]),
          );
          const detail = await (
            await queue(`kind=profile&id=${old.id}`)
          ).json();
          assert.equal(detail.profile.moderationStatus, "approved");
          assert.ok(
            detail.items.some(
              (item) =>
                item.action === "profile_approved" && item.snapshot.biography,
            ),
          );
          assert.equal((await edit(0)).status, 200);
          assert.equal((await creator(0)).moderation_status, "pending");
          assert.ok(
            !(await (await call("/discover")).text()).includes(names[0]),
          );
          assert.equal((await decision("approve")).status, 200);
        },
      );
      await t.test(
        "rejection exposes only the creator-facing reason and retains direct link access",
        async () => {
          assert.equal((await decision("reject", 1)).status, 200);
          const row = await (
            await call("/api/creator-profile", "GET", undefined, cookies[1])
          ).json();
          assert.equal(row.profile.moderationStatus, "rejected");
          assert.match(row.profile.moderationReason, /creator-visible/);
          assert.ok(!JSON.stringify(row).includes("staff-only-note"));
          assert.equal((await call("/creators/" + names[1])).status, 200);
          assert.ok(
            !(await (await call("/discover")).text()).includes(names[1]),
          );
          const history = await own(1);
          rejectedId = history.decisions.find(
            (item) => item.action === "profile_rejected",
          ).id;
          assert.ok(!JSON.stringify(history).includes("internalNote"));
          assert.ok(!JSON.stringify(history).includes("staff-only-note"));
        },
      );
      await t.test(
        "reports persist independently, reject duplicate spam, and preserve evidence privately",
        async () => {
          const response = await safety(
            {
              action: "report",
              username: names[0],
              reason: "Privacy violation",
              explanation: "Private report explanation " + tag,
            },
            1,
          );
          assert.equal(response.status, 201);
          reportId = (await response.json()).id;
          assert.equal(
            (
              await safety(
                { action: "report", username: names[0], reason: "Spam" },
                1,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await safety(
                { action: "report", username: "yukibloom", reason: "Spam" },
                1,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await safety(
                { action: "report", username: names[1], reason: "Spam" },
                1,
              )
            ).status,
            400,
          );
          const reauthenticated = await own(1, await token(ids[1]));
          assert.ok(
            reauthenticated.reports.some((item) => item.id === reportId),
          );
          assert.equal((await own(0)).reports.length, 0);
          const staffQueue = await (
            await queue("kind=reports&status=open")
          ).json();
          const report = staffQueue.items.find((item) => item.id === reportId);
          assert.equal(report.snapshot.username, names[0]);
          assert.equal("reporterId" in report, false);
          const publicText = await (await call("/creators/" + names[0])).text();
          assert.ok(!publicText.includes("Private report explanation"));
          assert.ok(!publicText.includes(`safety-1-${tag}@example.test`));
          assert.ok(!publicText.includes("staff-only-note"));
        },
      );
      await t.test(
        "account blocks persist, are private, and filter both authenticated directions",
        async () => {
          assert.equal((await decision("approve", 1)).status, 200);
          const response = await safety(
            { action: "block", username: names[0] },
            1,
          );
          assert.equal(response.status, 201);
          blockId = (await response.json()).id;
          assert.equal(
            (await safety({ action: "block", username: names[0] }, 1)).status,
            409,
          );
          assert.equal(
            (await safety({ action: "block", username: names[0] }, 0)).status,
            400,
          );
          assert.ok(
            (await own(1, await token(ids[1]))).blocks.some(
              (item) => item.id === blockId,
            ),
          );
          assert.equal((await own(0)).blocks.length, 0);
          assert.equal(
            (await call("/creators/" + names[0], "GET", undefined, cookies[1]))
              .status,
            404,
          );
          assert.equal(
            (await call("/creators/" + names[1], "GET", undefined, cookies[0]))
              .status,
            404,
          );
          assert.equal((await call("/creators/" + names[0])).status, 200);
          assert.ok(
            !(
              await (
                await call("/discover", "GET", undefined, cookies[1])
              ).text()
            ).includes(names[0]),
          );
          assert.ok(
            !(
              await (
                await call("/discover", "GET", undefined, cookies[0])
              ).text()
            ).includes(names[1]),
          );
          assert.equal(
            (await safety({ action: "unblock", blockId }, 0)).status,
            404,
          );
          assert.equal(
            (await edit(0, { username: `renamed_${tag}` })).status,
            200,
          );
          assert.equal(
            (
              await call(
                "/creators/renamed_" + tag,
                "GET",
                undefined,
                cookies[1],
              )
            ).status,
            404,
          );
          assert.equal(
            (await safety({ action: "unblock", blockId }, 1)).status,
            200,
          );
          assert.equal(
            (
              await call(
                "/creators/renamed_" + tag,
                "GET",
                undefined,
                cookies[1],
              )
            ).status,
            200,
          );
          assert.equal((await edit(0)).status, 200);
        },
      );
      await t.test(
        "review requests are owner-scoped, deduplicated, and answered without exposing staff notes",
        async () => {
          assert.equal(
            (
              await safety(
                {
                  action: "appeal",
                  decisionId: rejectedId,
                  explanation: "Please review my profile again carefully.",
                },
                0,
              )
            ).status,
            404,
          );
          const response = await safety(
            {
              action: "appeal",
              decisionId: rejectedId,
              explanation: "I have context for another fair review.",
            },
            1,
          );
          assert.equal(response.status, 201);
          appealId = (await response.json()).id;
          assert.equal(
            (
              await safety(
                {
                  action: "appeal",
                  decisionId: rejectedId,
                  explanation: "Another repeated request for this decision.",
                },
                1,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await admin({
                action: "review_appeal",
                appealId,
                resolution:
                  "We reviewed this request and explained the next steps.",
                internalNote: "staff-only-note-" + tag,
              })
            ).status,
            200,
          );
          const requests = (await own(1, await token(ids[1]))).appeals;
          assert.equal(
            requests.find((item) => item.id === appealId).status,
            "reviewed",
          );
          assert.ok(!JSON.stringify(requests).includes("staff-only-note"));
          assert.equal(
            (
              await admin({
                action: "review_appeal",
                appealId,
                resolution: "Repeated review should be rejected.",
              })
            ).status,
            409,
          );
        },
      );
      await t.test(
        "report resolution is staff-only, atomic, auditable, and scoped to the reporter",
        async () => {
          const body = {
            action: "resolve_report",
            reportId,
            status: "resolved",
            resolution: "Thank you. The reported profile has been reviewed.",
            internalNote: "staff-only-note-" + tag,
          };
          assert.equal((await admin(body, 1)).status, 403);
          assert.equal((await admin(body)).status, 200);
          assert.equal((await admin(body)).status, 409);
          const result = await own(1);
          assert.equal(
            result.reports.find((item) => item.id === reportId).status,
            "resolved",
          );
          assert.ok(!JSON.stringify(result).includes("staff-only-note"));
          assert.equal((await own(0)).reports.length, 0);
          assert.equal(
            (
              await sql`select count(*)::int as n from moderation_audit where entity_type='report' and entity_id=${reportId} and action='report_resolved'`
            )[0].n,
            1,
          );
        },
      );
      await t.test(
        "staff cannot resolve reports they submitted or reports about their own profile",
        async () => {
          for (const [reporter, target] of [
            [0, 2],
            [2, 0],
          ]) {
            const response = await safety(
              { action: "report", username: names[target], reason: "Spam" },
              reporter,
            );
            assert.equal(response.status, 201);
            const body = {
              action: "resolve_report",
              reportId: (await response.json()).id,
              status: "dismissed",
              resolution: "An independent administrator reviewed this report.",
            };
            assert.equal((await admin(body)).status, 403);
            assert.equal((await admin(body, 3)).status, 200);
          }
        },
      );
      await t.test(
        "suspension survives edits, renaming, and appeals; restoration preserves hidden visibility",
        async () => {
          assert.equal((await decision("suspend")).status, 200);
          const suspension = (await own(0)).decisions.find(
            (item) => item.action === "profile_suspended",
          );
          assert.equal(
            (await edit(0, { username: `evade_${tag}` })).status,
            200,
          );
          assert.equal((await creator(0)).moderation_status, "suspended");
          assert.match((await creator(0)).moderation_reason, /creator-visible/);
          assert.equal((await call("/creators/evade_" + tag)).status, 404);
          assert.equal(
            (
              await call(
                "/api/creator-profile",
                "POST",
                profileInput(`new_${tag}`),
                cookies[0],
              )
            ).status,
            409,
          );
          assert.equal(
            (await edit(0, { moderationStatus: "approved" })).status,
            400,
          );
          const appeal = await safety(
            {
              action: "appeal",
              decisionId: suspension.id,
              explanation:
                "Please reconsider the suspension with this context.",
            },
            0,
          );
          assert.equal(appeal.status, 201);
          assert.equal(
            (
              await admin({
                action: "review_appeal",
                appealId: (await appeal.json()).id,
                resolution:
                  "Another review is complete; enforcement is unchanged.",
              })
            ).status,
            200,
          );
          assert.equal((await creator(0)).moderation_status, "suspended");
          assert.equal((await edit(0, { visibility: "hidden" })).status, 200);
          assert.equal((await decision("restore")).status, 200);
          assert.equal((await creator(0)).moderation_status, "pending");
          assert.equal((await call("/creators/" + names[0])).status, 404);
          assert.equal((await decision("approve")).status, 409);
          assert.equal((await edit(0)).status, 200);
          assert.equal((await decision("approve")).status, 200);
        },
      );
      await t.test(
        "queues and history are bounded and paginated; malformed requests cannot mutate data",
        async () => {
          const target = await creator(0);
          for (let i = 0; i < 23; i++)
            await sql`insert into profile_reports(reporter_id,profile_id,target_username,reason,status) values(${ids[1]},${target.id},${names[0]},'Spam','resolved')`;
          const first = await (
              await queue("kind=reports&status=resolved&page=1")
            ).json(),
            second = await (
              await queue("kind=reports&status=resolved&page=2")
            ).json();
          assert.equal(first.items.length, 20);
          assert.equal(first.hasMore, true);
          assert.ok(second.items.length > 0 && second.items.length <= 20);
          assert.ok(
            first.items.every(
              (item) => !second.items.some((other) => item.id === other.id),
            ),
          );
          const json = JSON.stringify(first);
          assert.ok(!json.includes("reporterId"));
          assert.ok(!json.includes("passwordHash"));
          assert.ok(!json.includes("@example.test"));
          assert.equal(
            (await queue("kind=profiles&status=pending&page=10001")).status,
            400,
          );
          assert.equal(
            (
              await safety({
                action: "report",
                username: names[0],
                reason: "anything",
                explanation: "x".repeat(9000),
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "persistent limits handle concurrent malformed attempts and hourly report spam",
        async () => {
          await sql`delete from safety_rate_limits where user_id=${ids[0]}`;
          const responses = await Promise.all(
            Array.from({ length: 35 }, () => safety({ action: "invalid" })),
          );
          assert.equal(
            responses.filter((item) => item.status === 400).length,
            30,
          );
          assert.equal(
            responses.filter((item) => item.status === 429).length,
            5,
          );
          await sql`delete from safety_rate_limits where user_id=${ids[0]}`;
          const responses2 = [];
          for (let i = 0; i < 6; i++)
            responses2.push(
              await safety({
                action: "report",
                username: names[1],
                reason: "Spam",
              }),
            );
          assert.deepEqual(
            responses2.map((item) => item.status),
            [201, 409, 409, 409, 409, 429],
          );
          assert.equal(responses2[5].headers.get("retry-after"), "3600");
        },
      );
      await t.test(
        "permission revocation takes effect with the same session and is audited",
        async () => {
          assert.match(
            provision(2, "revoke", "moderator"),
            /audit record saved/,
          );
          assert.equal((await queue("kind=profiles&status=all")).status, 403);
          assert.equal(
            (await call("/admin/moderation", "GET", undefined, cookies[2]))
              .status,
            403,
          );
          assert.equal((await decision("suspend")).status, 403);
          assert.equal(
            (await queue("kind=profiles&status=all", 3)).status,
            200,
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from moderation_audit where entity_type='permission' and entity_id=${ids[2]} and action='staff_revoked'`
            )[0].n,
            1,
          );
        },
      );
      await t.test(
        "demo reports remain isolated and payment routes stay disabled",
        async () => {
          assert.equal((await call("/creators/yukibloom")).status, 200);
          assert.equal((await call("/api/stripe/checkout")).status, 503);
          assert.equal(
            (await call("/api/stripe/webhook", "POST", {})).status,
            503,
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from profile_reports where target_username='yukibloom'`
            )[0].n,
            0,
          );
        },
      );
    } finally {
      try {
        if (ids.length)
          await sql.begin(async (tx) => {
            await tx`delete from moderation_appeals where user_id = any(${ids}::int[]) or profile_id in(select id from creator_profiles where user_id = any(${ids}::int[]))`;
            await tx`delete from profile_reports where reporter_id = any(${ids}::int[]) or profile_id in(select id from creator_profiles where user_id = any(${ids}::int[]))`;
            await tx`delete from moderation_audit where actor_id = any(${ids}::int[]) or profile_id in(select id from creator_profiles where user_id = any(${ids}::int[])) or (entity_type='permission' and entity_id = any(${ids}::int[]))`;
            await tx`delete from account_blocks where blocker_id = any(${ids}::int[]) or blocked_id = any(${ids}::int[])`;
            await tx`delete from platform_staff where user_id = any(${ids}::int[])`;
            await tx`delete from safety_rate_limits where user_id = any(${ids}::int[])`;
            await tx`delete from creator_mutation_limits where user_id = any(${ids}::int[])`;
            await tx`delete from creator_profiles where user_id = any(${ids}::int[])`;
            await tx`delete from users where id = any(${ids}::int[])`;
          });
      } finally {
        await sql.end();
      }
    }
  },
);
