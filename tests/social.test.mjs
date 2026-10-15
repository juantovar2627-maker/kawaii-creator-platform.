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
  "real social network: independent accounts, publication, reactions, safety, and persistence",
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
    const sql = postgres(databaseUrl, { max: 4 });
    const tag = randomBytes(6).toString("hex"),
      ids = [],
      cookies = [],
      names = [`words_a_${tag}`, `words_b_${tag}`];
    let postId, commentId, removedCommentId, reportId;
    const token = async (id) =>
      "session=" +
      (await new SignJWT({
        user: { id },
        expires: new Date(Date.now() + 3600000).toISOString(),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(secret)));
    const call = (path, method = "GET", body, as, headers = {}) =>
      fetch(new URL(path, base), {
        method,
        headers: {
          Origin: new URL(base).origin,
          "Content-Type": "application/json",
          ...(as === undefined
            ? {}
            : { Cookie: typeof as === "string" ? as : cookies[as] }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
      });
    const social = (body, as = 0, headers = {}) =>
      call("/api/social", "POST", body, as, headers);
    const get = async (query, as) => {
      const response = await call("/api/social?" + query, "GET", undefined, as);
      assert.equal(response.status, 200, query);
      return response.json();
    };
    const post = async (id) =>
      (await sql`select * from social_posts where id=${id}`)[0];
    const comment = async (id) =>
      (await sql`select * from social_comments where id=${id}`)[0];
    const profile = async (member) =>
      (
        await sql`select * from creator_profiles where user_id=${ids[member]}`
      )[0];
    const approveProfile = async (member, action = "approve") => {
      const row = await profile(member);
      return call(
        "/api/admin/moderation",
        "POST",
        {
          action,
          profileId: row.id,
          revision: row.revision,
          reason: "A verified community-suitable profile decision.",
        },
        3,
      );
    };
    const moderate = async (action, id, more = {}) => {
      const row = action.includes("comment")
        ? await comment(id)
        : await post(id);
      return call(
        "/api/admin/social",
        "POST",
        {
          action,
          id,
          revision: row.revision,
          reason: "A clear author-facing content review decision.",
          internalNote: "private-social-staff-" + tag,
          ...more,
        },
        3,
      );
    };
    const create = async (body = "A gentle text-only moment.", as = 0) => {
      const response = await social(
        { action: "create_post", title: "Paper stars " + tag, body },
        as,
      );
      assert.equal(response.status, 200);
      return (await response.json()).id;
    };
    const submit = async (id) => {
      const row = await post(id);
      return social({ action: "submit_post", id, revision: row.revision });
    };
    const contains = (feed, id) => feed.items.some((item) => item.id === id);
    const reset = () =>
      sql`delete from safety_rate_limits where user_id = any(${ids}::int[])`;
    try {
      const passwordHash = await hash(randomBytes(20).toString("hex"), 10);
      for (let i = 0; i < 4; i++) {
        const [row] =
          await sql`insert into users(email,password_hash,name,role) values(${`social-${i}-${tag}@example.test`},${passwordHash},${"Private account " + i + " " + tag},'owner') returning id`;
        ids.push(row.id);
        cookies.push(await token(row.id));
      }
      execFileSync(
        process.execPath,
        [
          "scripts/platform-staff.mjs",
          "--action",
          "grant",
          "--user-id",
          String(ids[3]),
          "--role",
          "moderator",
          "--operator",
          "social-test-fixture",
          "--reason",
          "Provision disposable social moderation test account.",
        ],
        { env: { ...process.env, POSTGRES_URL: databaseUrl }, stdio: "pipe" },
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await call(
              "/api/creator-profile",
              "POST",
              {
                username: names[i],
                displayName: "Real creator " + i,
                biography: "Art and respectful words.",
                categories: ["Art & illustration"],
                visibility: "listed",
                communityAccepted: true,
              },
              i,
            )
          ).status,
          201,
        );
      await t.test(
        "authentication, CSRF, strict input and platform permissions protect social writes",
        async () => {
          assert.equal(
            (
              await call("/api/social", "POST", {
                action: "create_post",
                body: "Anonymous",
              })
            ).status,
            401,
          );
          assert.equal(
            (
              await social(
                { action: "follow", username: names[1], following: true },
                0,
                { Origin: "https://other.example" },
              )
            ).status,
            403,
          );
          assert.equal(
            (await social({ action: "create_post", body: "x", userId: ids[1] }))
              .status,
            400,
          );
          assert.equal(
            (
              await social({
                action: "create_post",
                body: "x",
                status: "published",
              })
            ).status,
            400,
          );
          assert.equal(
            (await social({ action: "create_post", body: "x".repeat(4001) }))
              .status,
            400,
          );
          assert.equal(
            (await call("/api/admin/social", "GET", undefined, 0)).status,
            403,
          );
          assert.equal(
            (
              await call(
                "/api/admin/social",
                "POST",
                {
                  action: "approve_post",
                  id: 1,
                  revision: 1,
                  reason: "Attempted self approval.",
                },
                0,
              )
            ).status,
            403,
          );
          assert.equal((await call("/api/social?view=workspace")).status, 401);
          assert.equal(
            (await call("/api/social?view=feed&scope=saved")).status,
            401,
          );
        },
      );
      await t.test(
        "real follows are idempotent, unique, private, and persistent across sessions",
        async () => {
          assert.equal(
            (
              await social(
                { action: "follow", username: names[0], following: true },
                0,
              )
            ).status,
            400,
          );
          const responses = await Promise.all(
            Array.from({ length: 5 }, () =>
              social(
                { action: "follow", username: names[0], following: true },
                2,
              ),
            ),
          );
          assert.ok(responses.every((row) => row.status === 200));
          assert.equal(
            (
              await sql`select count(*)::int as n from creator_follows where follower_id=${ids[2]} and creator_id=${ids[0]}`
            )[0].n,
            1,
          );
          assert.equal(
            (await get("view=creator&username=" + names[0])).followers,
            1,
          );
          assert.equal(
            (await get("view=following", await token(ids[2]))).items[0]
              .username,
            names[0],
          );
          assert.equal((await get("view=following", 1)).items.length, 0);
          assert.equal(
            (
              await social(
                { action: "follow", username: names[0], following: false },
                2,
              )
            ).status,
            200,
          );
          assert.equal(
            (await get("view=creator&username=" + names[0])).followers,
            0,
          );
          assert.equal(
            (
              await social(
                { action: "follow", username: names[0], following: true },
                2,
              )
            ).status,
            200,
          );
        },
      );
      await t.test(
        "drafts and pending text are private; ownership and revisions protect editing",
        async () => {
          postId = await create(
            '<script>alert("safe")</script> Plain text only.',
          );
          assert.equal(
            (await call("/api/social?view=post&id=" + postId)).status,
            404,
          );
          assert.ok(!contains(await get("view=feed"), postId));
          assert.equal(
            (await call("/api/social?view=comments&id=" + postId)).status,
            404,
          );
          assert.ok(
            (await get("view=workspace", 0)).items.some(
              (row) => row.id === postId,
            ),
          );
          assert.equal((await get("view=workspace", 1)).items.length, 0);
          assert.equal(
            (
              await call(
                "/api/social?view=workspace&userId=" + ids[0],
                "GET",
                undefined,
                1,
              )
            ).status,
            400,
          );
          let row = await post(postId);
          assert.equal(
            (
              await social(
                {
                  action: "edit_post",
                  id: postId,
                  revision: row.revision,
                  title: "Hijack",
                  body: "Cannot change this",
                },
                1,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await social(
                { action: "delete_post", id: postId, revision: row.revision },
                1,
              )
            ).status,
            404,
          );
          assert.equal((await submit(postId)).status, 200);
          assert.equal(
            (await call("/api/social?view=post&id=" + postId)).status,
            404,
          );
          row = await post(postId);
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: 1,
                title: "Old",
                body: "Stale write",
              })
            ).status,
            409,
          );
          assert.equal(
            (await moderate("approve_post", postId)).status,
            409,
            "Creator approval is required before publication",
          );
          assert.equal((await approveProfile(0)).status, 200);
          assert.equal((await approveProfile(1)).status, 200);
          assert.equal((await moderate("approve_post", postId)).status, 200);
        },
      );
      await t.test(
        "approved posts appear in feeds, creator pages, following and home previews without private data",
        async () => {
          assert.ok(contains(await get("view=feed"), postId));
          assert.ok(contains(await get("view=feed&scope=home"), postId));
          assert.ok(
            contains(
              await get("view=feed&scope=creator&username=" + names[0]),
              postId,
            ),
          );
          assert.ok(
            contains(await get("view=feed&scope=following", 2), postId),
          );
          assert.ok(
            !contains(await get("view=feed&scope=following", 1), postId),
          );
          const item = await get("view=post&id=" + postId);
          assert.match(item.body, /<script>/);
          assert.equal(item.creator.username, names[0]);
          const serialized = JSON.stringify(item);
          for (const forbidden of [
            "passwordHash",
            "password_hash",
            "userId",
            "user_id",
            "Private account",
            `social-0-${tag}@example.test`,
            "private-social-staff",
          ])
            assert.ok(!serialized.includes(forbidden), forbidden);
        },
      );
      await t.test(
        "likes and private saves persist and resist duplicate concurrent requests",
        async () => {
          const liked = await Promise.all(
            Array.from({ length: 5 }, () =>
              social({ action: "like", postId, liked: true }, 2),
            ),
          );
          assert.ok(liked.every((row) => row.status === 200));
          assert.equal((await get("view=post&id=" + postId, 2)).likes, 1);
          assert.equal(
            (await get("view=post&id=" + postId, await token(ids[2]))).liked,
            true,
          );
          assert.equal(
            (await social({ action: "like", postId, liked: false }, 2)).status,
            200,
          );
          assert.equal((await get("view=post&id=" + postId)).likes, 0);
          for (let i = 0; i < 2; i++)
            assert.equal(
              (await social({ action: "save", postId, saved: true }, 2)).status,
              200,
            );
          assert.ok(
            contains(
              await get("view=feed&scope=saved", await token(ids[2])),
              postId,
            ),
          );
          assert.ok(!contains(await get("view=feed&scope=saved", 1), postId));
          assert.equal(
            (
              await sql`select count(*)::int as n from saved_posts where user_id=${ids[2]} and post_id=${postId}`
            )[0].n,
            1,
          );
        },
      );
      await t.test(
        "comments use escaped plain text, safe author identities, ownership and revisions",
        async () => {
          const response = await social(
            {
              action: "comment",
              postId,
              body: "<img src=x onerror=alert(1)> A kind little note.",
            },
            2,
          );
          assert.equal(response.status, 200);
          commentId = (await response.json()).id;
          let comments = await get("view=comments&id=" + postId, 2);
          const item = comments.items.find((row) => row.id === commentId);
          assert.equal(
            item.author,
            null,
            "Private account names never become public comment names",
          );
          assert.equal(item.mine, true);
          assert.ok(!JSON.stringify(comments).includes("Private account"));
          assert.ok(!JSON.stringify(comments).includes("@example.test"));
          assert.equal(
            (
              await social(
                {
                  action: "edit_comment",
                  id: commentId,
                  revision: item.revision,
                  body: "Hijacked",
                },
                1,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await social(
                {
                  action: "delete_comment",
                  id: commentId,
                  revision: item.revision,
                },
                1,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await social(
                { action: "comment", postId, body: "x".repeat(601) },
                2,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await social(
                {
                  action: "edit_comment",
                  id: commentId,
                  revision: item.revision,
                  body: "Updated thoughtful words.",
                },
                2,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await social(
                {
                  action: "edit_comment",
                  id: commentId,
                  revision: item.revision,
                  body: "A stale edit",
                },
                2,
              )
            ).status,
            409,
          );
          comments = await get(
            "view=comments&id=" + postId,
            await token(ids[2]),
          );
          assert.equal(
            comments.items.find((row) => row.id === commentId).body,
            "Updated thoughtful words.",
          );
          assert.ok(
            (await get("view=comments&id=" + postId, 0)).items.some(
              (row) => row.id === commentId,
            ),
            "Creator can view comments on their post",
          );
        },
      );
      await reset();
      await t.test(
        "content reports are real, private, deduplicated and staff-resolved with evidence",
        async () => {
          const response = await social(
            {
              action: "report",
              target: "comment",
              id: commentId,
              reason: "Spam",
              explanation: "Private social report " + tag,
            },
            1,
          );
          assert.equal(response.status, 200);
          assert.equal(
            (
              await social(
                {
                  action: "report",
                  target: "comment",
                  id: commentId,
                  reason: "Spam",
                },
                1,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await social(
                {
                  action: "report",
                  target: "comment",
                  id: commentId,
                  reason: "Spam",
                },
                2,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await social(
                {
                  action: "report",
                  target: "post",
                  id: postId,
                  reason: "Spam",
                },
                0,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await social(
                {
                  action: "report",
                  target: "post",
                  id: postId,
                  reason: "Spam",
                },
                1,
              )
            ).status,
            200,
          );
          const queue = await (
            await call(
              "/api/admin/social?kind=reports&status=open",
              "GET",
              undefined,
              3,
            )
          ).json();
          const report = queue.items.find((row) => row.commentId === commentId);
          reportId = report.id;
          assert.equal(report.snapshot.body, "Updated thoughtful words.");
          assert.ok(!JSON.stringify(queue).includes("reporterId"));
          assert.equal(
            (
              await call(
                "/api/admin/social",
                "POST",
                {
                  action: "resolve_report",
                  id: reportId,
                  status: "resolved",
                  resolution: "This comment report has been reviewed.",
                  internalNote: "private-social-staff-" + tag,
                },
                3,
              )
            ).status,
            200,
          );
          const own = await get("view=activity", await token(ids[1]));
          assert.ok(
            own.reports.some(
              (row) => row.id === reportId && row.status === "resolved",
            ),
          );
          assert.ok(!JSON.stringify(own).includes("private-social-staff"));
          assert.equal((await get("view=activity", 2)).reports.length, 0);
          assert.ok(
            !JSON.stringify(await get("view=feed")).includes(
              "Private social report",
            ),
          );
        },
      );
      await t.test(
        "staff removal survives owner edits; content review requests are owner-scoped",
        async () => {
          assert.equal(
            (await moderate("remove_comment", commentId)).status,
            200,
          );
          removedCommentId = commentId;
          assert.ok(
            !(await get("view=comments&id=" + postId)).items.some(
              (row) => row.id === commentId,
            ),
          );
          let row = await comment(commentId);
          assert.equal(
            (
              await social(
                {
                  action: "edit_comment",
                  id: commentId,
                  revision: row.revision,
                  body: "Try to evade removal",
                },
                2,
              )
            ).status,
            403,
          );
          const decision = (await get("view=activity", 2)).decisions.find(
            (row) => row.action === "comment_removed",
          );
          assert.ok(decision);
          assert.equal(
            (
              await social(
                {
                  action: "appeal",
                  decisionId: decision.id,
                  explanation: "Please review this comment decision again.",
                },
                1,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await social(
                {
                  action: "appeal",
                  decisionId: decision.id,
                  explanation: "Please review this comment decision again.",
                },
                2,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await social(
                {
                  action: "appeal",
                  decisionId: decision.id,
                  explanation: "Repeated request for this comment decision.",
                },
                2,
              )
            ).status,
            409,
          );
          const appeals = await (
            await call(
              "/api/admin/social?kind=appeals&status=open",
              "GET",
              undefined,
              3,
            )
          ).json();
          const appeal = appeals.items.find(
            (row) => row.entityId === commentId && row.entityType === "comment",
          );
          assert.ok(appeal);
          assert.equal(
            (
              await call(
                "/api/admin/social",
                "POST",
                {
                  action: "review_appeal",
                  id: appeal.id,
                  resolution: "Another content review is complete.",
                },
                3,
              )
            ).status,
            200,
          );
          assert.equal((await comment(commentId)).status, "removed");
          assert.equal(
            (await moderate("restore_comment", commentId)).status,
            200,
          );
          assert.ok(
            (await get("view=comments&id=" + postId)).items.some(
              (row) => row.id === commentId,
            ),
          );
        },
      );
      await t.test(
        "published edits withdraw content and require fresh approval, including stale review protection",
        async () => {
          let row = await post(postId);
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: row.revision,
                title: "Revised paper stars " + tag,
                body: "Fresh words need a fresh review.",
              })
            ).status,
            200,
          );
          assert.equal((await post(postId)).status, "draft");
          assert.ok(!contains(await get("view=feed"), postId));
          assert.ok(!contains(await get("view=feed&scope=saved", 2), postId));
          assert.equal(
            (await call("/api/social?view=post&id=" + postId)).status,
            404,
          );
          assert.equal(
            (await call("/api/social?view=comments&id=" + postId)).status,
            404,
          );
          assert.equal((await submit(postId)).status, 200);
          row = await post(postId);
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: row.revision,
                title: "Edited pending " + tag,
                body: "No stale staff approval may publish this version.",
              })
            ).status,
            200,
          );
          const stale = await call(
            "/api/admin/social",
            "POST",
            {
              action: "approve_post",
              id: postId,
              revision: row.revision,
              reason: "Stale review must fail safely.",
            },
            3,
          );
          assert.ok([404, 409].includes(stale.status));
          assert.equal((await submit(postId)).status, 200);
          assert.equal((await moderate("reject_post", postId)).status, 200);
          assert.equal((await post(postId)).status, "rejected");
          assert.equal((await submit(postId)).status, 200);
          assert.equal((await moderate("approve_post", postId)).status, 200);
          assert.ok(contains(await get("view=feed&scope=saved", 2), postId));
        },
      );
      await reset();
      await t.test(
        "both block directions remove follows and gate every real social surface and mutation",
        async () => {
          assert.equal(
            (
              await social(
                { action: "follow", username: names[0], following: true },
                1,
              )
            ).status,
            200,
          );
          const blocked = await call(
            "/api/safety",
            "POST",
            { action: "block", username: names[1] },
            0,
          );
          assert.equal(blocked.status, 201);
          const blockId = (await blocked.json()).id;
          assert.equal(
            (
              await sql`select count(*)::int as n from creator_follows where follower_id=${ids[1]} and creator_id=${ids[0]}`
            )[0].n,
            0,
          );
          for (const [viewer, target] of [
            [1, names[0]],
            [0, names[1]],
          ])
            assert.equal(
              (
                await social(
                  { action: "follow", username: target, following: true },
                  viewer,
                )
              ).status,
              404,
            );
          assert.ok(!contains(await get("view=feed", 1), postId));
          assert.equal(
            (
              await call(
                "/api/social?view=post&id=" + postId,
                "GET",
                undefined,
                1,
              )
            ).status,
            404,
          );
          for (const body of [
            { action: "like", postId, liked: true },
            { action: "save", postId, saved: true },
            { action: "comment", postId, body: "Blocked comment" },
          ])
            assert.equal((await social(body, 1)).status, 404);
          assert.equal(
            (
              await call(
                "/api/social?view=comments&id=" + postId,
                "GET",
                undefined,
                1,
              )
            ).status,
            404,
          );
          assert.ok(
            contains(await get("view=feed"), postId),
            "Public content remains available anonymously",
          );
          assert.equal(
            (
              await call(
                "/api/safety",
                "POST",
                { action: "unblock", blockId },
                0,
              )
            ).status,
            200,
          );
          assert.equal(
            (await get("view=creator&username=" + names[0], 1)).following,
            false,
          );
          const race = await Promise.all([
            social(
              { action: "follow", username: names[0], following: true },
              1,
            ),
            call(
              "/api/safety",
              "POST",
              { action: "block", username: names[1] },
              0,
            ),
          ]);
          assert.ok([200, 404].includes(race[0].status));
          assert.equal(race[1].status, 201);
          assert.equal(
            (
              await sql`select count(*)::int as n from creator_follows where follower_id=${ids[1]} and creator_id=${ids[0]}`
            )[0].n,
            0,
          );
          assert.equal(
            (
              await call(
                "/api/safety",
                "POST",
                { action: "unblock", blockId: (await race[1].json()).id },
                0,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await social(
                {
                  action: "follow",
                  username: "unknown_" + tag,
                  following: false,
                },
                1,
              )
            ).status,
            200,
            "Unfollow cannot enumerate hidden account existence",
          );
        },
      );
      await t.test(
        "hidden, unlisted, suspended, and deleted creators cannot leak posts through saved lists",
        async () => {
          const original = await profile(0);
          await sql`update creator_profiles set visibility='hidden' where id=${original.id}`;
          assert.ok(!contains(await get("view=feed&scope=saved", 2), postId));
          assert.equal(
            (
              await social(
                { action: "follow", username: names[0], following: true },
                1,
              )
            ).status,
            404,
          );
          assert.equal(
            (await social({ action: "like", postId, liked: true }, 1)).status,
            404,
          );
          await sql`update creator_profiles set visibility='unlisted' where id=${original.id}`;
          assert.ok(!contains(await get("view=feed"), postId));
          assert.ok(
            contains(
              await get("view=feed&scope=creator&username=" + names[0]),
              postId,
            ),
          );
          await sql`update creator_profiles set visibility='listed' where id=${original.id}`;
          assert.equal((await approveProfile(0, "suspend")).status, 200);
          assert.ok(!contains(await get("view=feed&scope=saved", 2), postId));
          assert.equal(
            (await call("/api/social?view=post&id=" + postId)).status,
            404,
          );
          assert.equal(
            (
              await social(
                {
                  action: "comment",
                  postId,
                  body: "Suspended creator commenting on self",
                },
                0,
              )
            ).status,
            403,
          );
          assert.equal((await approveProfile(0, "restore")).status, 200);
          assert.ok(!contains(await get("view=feed"), postId));
          assert.equal((await approveProfile(0)).status, 200);
          await sql`update users set deleted_at=now() where id=${ids[0]}`;
          assert.ok(!contains(await get("view=feed&scope=saved", 2), postId));
          assert.equal(
            (await social({ action: "like", postId, liked: true }, 0)).status,
            401,
          );
          await sql`update users set deleted_at=null where id=${ids[0]}`;
          assert.equal((await approveProfile(1, "suspend")).status, 200);
          for (const body of [
            { action: "like", postId, liked: true },
            { action: "save", postId, saved: true },
            { action: "comment", postId, body: "Suspended author" },
            { action: "follow", username: names[0], following: true },
          ])
            assert.equal((await social(body, 1)).status, 403);
          assert.equal((await approveProfile(1, "restore")).status, 200);
          assert.equal((await approveProfile(1)).status, 200);
        },
      );
      await t.test(
        "post removal cannot be resubmitted; review requests do not automatically restore access",
        async () => {
          assert.equal((await moderate("remove_post", postId)).status, 200);
          assert.ok(!contains(await get("view=feed&scope=saved", 2), postId));
          let row = await post(postId);
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: row.revision,
                body: "Evade",
                title: "Evade",
              })
            ).status,
            403,
          );
          assert.equal((await submit(postId)).status, 403);
          const decision = (await get("view=activity", 0)).decisions.find(
            (row) => row.action === "post_removed",
          );
          assert.equal(
            (
              await social({
                action: "appeal",
                decisionId: decision.id,
                explanation: "Please review this post removal again.",
              })
            ).status,
            200,
          );
          assert.equal((await post(postId)).status, "removed");
          assert.equal((await moderate("restore_post", postId)).status, 200);
          assert.equal((await post(postId)).status, "pending");
          assert.ok(!contains(await get("view=feed"), postId));
          assert.equal((await moderate("approve_post", postId)).status, 200);
        },
      );
      await t.test(
        "members without creator profiles can be blocked safely from comments",
        async () => {
          assert.equal(
            (await social({ action: "block_comment_author", commentId }, 2))
              .status,
            400,
          );
          assert.equal(
            (await social({ action: "block_comment_author", commentId }, 0))
              .status,
            200,
          );
          const ownSafety = await (
            await call("/api/safety", "GET", undefined, 0)
          ).json();
          const block = ownSafety.blocks.find(
            (item) => item.username === "mimi_member",
          );
          assert.ok(block);
          assert.equal(block.displayName, "Mimi member");
          assert.ok(
            !JSON.stringify(ownSafety.blocks).includes("Private account"),
          );
          assert.ok(
            !(await get("view=comments&id=" + postId, 0)).items.some(
              (item) => item.id === commentId,
            ),
          );
          assert.ok(
            (await get("view=comments&id=" + postId)).items.some(
              (item) => item.id === commentId,
            ),
          );
          assert.equal(
            (
              await call(
                "/api/social?view=post&id=" + postId,
                "GET",
                undefined,
                2,
              )
            ).status,
            404,
          );
          assert.equal(
            (await get("view=creator&username=" + names[0])).followers,
            0,
          );
          assert.equal(
            (
              await call(
                "/api/safety",
                "POST",
                { action: "unblock", blockId: block.id },
                0,
              )
            ).status,
            200,
          );
        },
      );
      await t.test(
        "feed and comment pagination are bounded, reverse chronological, and exclude private states",
        async () => {
          const owner = await profile(0);
          const fixtures = [];
          for (let i = 0; i < 13; i++) {
            const [row] =
              await sql`insert into social_posts(profile_id,title,body,status,published_at) values(${owner.id},${"Pagination " + i},'Plain fixture text','published',now()+${i}*interval '1 second') returning id`;
            fixtures.push(row.id);
          }
          const first = await get(
              "view=feed&scope=creator&username=" + names[0] + "&page=1",
            ),
            second = await get(
              "view=feed&scope=creator&username=" + names[0] + "&page=2",
            );
          assert.equal(first.items.length, 10);
          assert.equal(first.hasMore, true);
          assert.ok(second.items.length > 0);
          assert.ok(
            first.items.every(
              (row) => !second.items.some((other) => other.id === row.id),
            ),
          );
          assert.equal(first.items[0].id, fixtures.at(-1));
          for (let i = 0; i < 12; i++)
            await sql`insert into social_comments(post_id,author_id,body) values(${postId},${ids[2]},${"Comment fixture " + i})`;
          const c1 = await get("view=comments&id=" + postId + "&page=1"),
            c2 = await get("view=comments&id=" + postId + "&page=2");
          assert.equal(c1.items.length, 10);
          assert.equal(c1.hasMore, true);
          assert.ok(c2.items.length > 0);
          assert.ok(
            c1.items.every(
              (row) => !c2.items.some((other) => other.id === row.id),
            ),
          );
          assert.equal(
            (await call("/api/social?view=feed&page=10001")).status,
            400,
          );
          assert.equal(
            (
              await call(
                "/api/admin/social?kind=posts&status=published&page=0",
                "GET",
                undefined,
                3,
              )
            ).status,
            400,
          );
        },
      );
      await t.test(
        "rate limits are persistent and concurrent malformed attempts cannot bypass them",
        async () => {
          await reset();
          const results = await Promise.all(
            Array.from({ length: 45 }, () => social({ action: "unknown" }, 2)),
          );
          assert.equal(results.filter((row) => row.status === 400).length, 40);
          assert.equal(results.filter((row) => row.status === 429).length, 5);
          await reset();
          const results2 = [];
          for (let i = 0; i < 11; i++)
            results2.push(
              await social(
                {
                  action: "comment",
                  postId,
                  body: "A rate-limited comment " + i,
                },
                2,
              ),
            );
          assert.deepEqual(
            results2.map((row) => row.status),
            [...Array(10).fill(200), 429],
          );
          assert.equal(results2[10].headers.get("retry-after"), "300");
        },
      );
      await reset();
      await t.test(
        "withdrawals and own comment deletion retain moderation history and cannot expose drafts",
        async () => {
          const row = await comment(commentId);
          assert.equal(
            (
              await social(
                {
                  action: "delete_comment",
                  id: commentId,
                  revision: row.revision,
                },
                2,
              )
            ).status,
            200,
          );
          assert.ok(
            !(await get("view=comments&id=" + postId)).items.some(
              (row) => row.id === commentId,
            ),
          );
          const privateDraft = "Never-submitted-private-draft-" + tag;
          const draft = await create(privateDraft);
          const draftRow = await post(draft);
          assert.equal(
            (
              await social({
                action: "delete_post",
                id: draft,
                revision: draftRow.revision,
              })
            ).status,
            200,
          );
          assert.ok(
            !(await get("view=workspace", 0)).items.some(
              (row) => row.id === draft,
            ),
          );
          const staffHistory = await (
            await call(
              "/api/admin/moderation?kind=profile&id=" + (await profile(0)).id,
              "GET",
              undefined,
              3,
            )
          ).json();
          assert.ok(
            !JSON.stringify(staffHistory).includes(privateDraft),
            "Withdrawing a private draft must not expose its body to staff audit views",
          );
          const published = await post(postId);
          assert.equal(
            (
              await social({
                action: "delete_post",
                id: postId,
                revision: published.revision,
              })
            ).status,
            200,
          );
          assert.ok(!contains(await get("view=feed&scope=saved", 2), postId));
          assert.ok(
            (
              await sql`select id from moderation_audit where entity_type='post' and entity_id=${postId}`
            ).length > 0,
          );
        },
      );
      await t.test(
        "fictional demos and payment-disabled endpoints remain separate",
        async () => {
          assert.equal(
            (
              await social(
                { action: "follow", username: "yukibloom", following: true },
                2,
              )
            ).status,
            404,
          );
          assert.equal((await call("/creators/yukibloom")).status, 200);
          assert.equal((await call("/api/stripe/checkout")).status, 503);
          assert.equal(
            (await call("/api/stripe/webhook", "POST", {})).status,
            503,
          );
          assert.equal(
            (
              await sql`select count(*)::int as n from social_posts where profile_id in (select id from creator_profiles where username='yukibloom')`
            )[0].n,
            0,
          );
        },
      );
    } finally {
      try {
        if (ids.length)
          await sql.begin(async (tx) => {
            await tx`delete from social_appeals where user_id=any(${ids}::int[])`;
            await tx`delete from social_reports where reporter_id=any(${ids}::int[]) or post_id in(select p.id from social_posts p join creator_profiles cp on cp.id=p.profile_id where cp.user_id=any(${ids}::int[])) or comment_id in(select id from social_comments where author_id=any(${ids}::int[]))`;
            await tx`delete from moderation_appeals where user_id=any(${ids}::int[])`;
            await tx`delete from profile_reports where reporter_id=any(${ids}::int[]) or profile_id in(select id from creator_profiles where user_id=any(${ids}::int[]))`;
            await tx`delete from moderation_audit where actor_id=any(${ids}::int[]) or profile_id in(select id from creator_profiles where user_id=any(${ids}::int[])) or(entity_type='permission' and entity_id=any(${ids}::int[]))`;
            await tx`delete from post_likes where user_id=any(${ids}::int[]) or post_id in(select p.id from social_posts p join creator_profiles cp on cp.id=p.profile_id where cp.user_id=any(${ids}::int[]))`;
            await tx`delete from saved_posts where user_id=any(${ids}::int[]) or post_id in(select p.id from social_posts p join creator_profiles cp on cp.id=p.profile_id where cp.user_id=any(${ids}::int[]))`;
            await tx`delete from social_comments where author_id=any(${ids}::int[]) or post_id in(select p.id from social_posts p join creator_profiles cp on cp.id=p.profile_id where cp.user_id=any(${ids}::int[]))`;
            await tx`delete from social_posts where profile_id in(select id from creator_profiles where user_id=any(${ids}::int[]))`;
            await tx`delete from creator_follows where follower_id=any(${ids}::int[]) or creator_id=any(${ids}::int[])`;
            await tx`delete from account_blocks where blocker_id=any(${ids}::int[]) or blocked_id=any(${ids}::int[])`;
            await tx`delete from platform_staff where user_id=any(${ids}::int[])`;
            await tx`delete from safety_rate_limits where user_id=any(${ids}::int[])`;
            await tx`delete from creator_mutation_limits where user_id=any(${ids}::int[])`;
            await tx`delete from creator_profiles where user_id=any(${ids}::int[])`;
            await tx`delete from users where id=any(${ids}::int[])`;
          });
      } finally {
        await sql.end();
      }
    }
  },
);
