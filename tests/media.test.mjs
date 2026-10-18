import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { SignJWT } from "jose";
import { hash } from "bcryptjs";

const base = process.env.TEST_BASE_URL,
  databaseUrl = process.env.TEST_DATABASE_URL,
  secret = process.env.AUTH_SECRET;
test(
  "private creator photos: processing, ownership, publication, enforcement and cleanup",
  { skip: !base || !databaseUrl || !secret },
  async (t) => {
    for (const url of [base, databaseUrl])
      assert.ok(
        ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
        "Development destinations only",
      );
    assert.equal(
      process.env.MEDIA_STORAGE_DRIVER,
      "local",
      "Media integration requires the private local adapter",
    );
    const root = process.env.MEDIA_LOCAL_ROOT;
    assert.ok(
      root?.startsWith("/"),
      "Set the same private local directory as the server",
    );
    const sql = postgres(databaseUrl, { max: 4 }),
      tag = randomBytes(6).toString("hex"),
      ids = [],
      cookies = [];
    const name = `photo_${tag}`;
    let postId, mainAsset;
    const call = (path, method = "GET", body, who, headers = {}) =>
      fetch(new URL(path, base), {
        method,
        headers: {
          Origin: new URL(base).origin,
          ...(body && !Buffer.isBuffer(body)
            ? { "Content-Type": "application/json" }
            : {}),
          ...(who === undefined ? {} : { Cookie: cookies[who] }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
        redirect: "manual",
      });
    const social = (body, who = 0) => call("/api/social", "POST", body, who);
    const media = (body, who = 0) => call("/api/media", "POST", body, who);
    const row = async () =>
      (await sql`select * from social_posts where id=${postId}`)[0];
    const asset = async (id) =>
      (await sql`select * from media_assets where id=${id}`)[0];
    const reserve = async (
      description = "A pastel lavender cardigan",
      target = postId,
    ) => {
      const p = (await sql`select * from social_posts where id=${target}`)[0];
      const r = await media({
        action: "reserve",
        postId: target,
        revision: p.revision,
        description,
      });
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
    const upload = (slot, bytes, who = 0, headers = {}) =>
      call(`/api/media/${slot.id}/upload`, "PUT", bytes, who, {
        "X-Upload-Token": slot.token,
        "Content-Type": "application/octet-stream",
        ...headers,
      });
    const remove = async (id) => {
      const r = await media({
        action: "remove",
        postId,
        revision: (await row()).revision,
        assetId: id,
      });
      assert.equal(r.status, 200, await r.clone().text());
    };
    const submit = () =>
      row().then((p) =>
        social({ action: "submit_post", id: postId, revision: p.revision }),
      );
    const decision = async (action = "approve_post", revision) =>
      call(
        "/api/admin/social",
        "POST",
        {
          action,
          id: postId,
          revision: revision ?? (await row()).revision,
          reason: "Reviewed the full text and all attached photos.",
          internalNote: "private-photo-review-" + tag,
        },
        2,
      );
    const read = (id, who, variant = "thumb") =>
      call(`/api/media/${id}?variant=${variant}`, "GET", undefined, who);
    const feed = async (who) =>
      (
        await (
          await call(
            "/api/social?view=feed&scope=creator&username=" + name,
            "GET",
            undefined,
            who,
          )
        ).json()
      ).items;
    const webp = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#c7a3e8" },
    })
      .webp()
      .toBuffer();
    const png = await sharp(webp).png().toBuffer();
    const blue = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const animated = await sharp([png, blue], { join: { animated: true } })
      .webp({ delay: [100, 100], loop: 0 })
      .toBuffer();
    assert.equal((await sharp(animated).metadata()).pages, 2);
    // Inject an APNG animation-control chunk. It must be rejected even when a
    // decoder would otherwise ignore this ancillary chunk and read frame one.
    const control = Buffer.alloc(20);
    control.writeUInt32BE(8, 0);
    control.write("acTL", 4);
    control.writeUInt32BE(2, 8);
    const apng = Buffer.concat([
      png.subarray(0, 33),
      control,
      png.subarray(33),
    ]);
    const jpeg = await sharp(webp)
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Artist: "private-metadata-" + tag } })
      .jpeg()
      .toBuffer();
    const moduleCheck = (source) =>
      execFileSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          source,
        ],
        { cwd: process.cwd(), env: process.env, encoding: "utf8" },
      );
    try {
      for (let i = 0; i < 3; i++) {
        const [user] =
          await sql`insert into users(name,email,password_hash) values(${`Photo test ${i}`},${`photo-${i}-${tag}@example.test`},${await hash(randomBytes(24).toString("hex"), 10)}) returning id`;
        ids.push(user.id);
        cookies.push(
          "session=" +
            (await new SignJWT({
              user: { id: user.id },
              expires: new Date(Date.now() + 3600000).toISOString(),
            })
              .setProtectedHeader({ alg: "HS256" })
              .setExpirationTime("1h")
              .sign(new TextEncoder().encode(secret))),
        );
      }
      execFileSync(
        process.execPath,
        [
          "scripts/platform-staff.mjs",
          "--action",
          "grant",
          "--user-id",
          String(ids[2]),
          "--role",
          "moderator",
          "--operator",
          "media-test",
          "--reason",
          "Provision disposable development photo reviewer.",
        ],
        { env: { ...process.env, POSTGRES_URL: databaseUrl }, stdio: "pipe" },
      );
      await sql`insert into creator_profiles(user_id,username,display_name,biography,theme,avatar,banner,categories,visibility,moderation_status) values(${ids[0]},${name},'Pastel photographer','Non-explicit fashion photography.','pink','star','blossom','["Lifestyle"]'::jsonb,'listed','approved')`;
      // Use the existing profile API defaults to keep the fixture aligned with DB presets.
      const created = await social({
        action: "create_post",
        title: "A little photo diary",
        body: "A gentle moment in lavender.",
      });
      assert.equal(created.status, 200);
      postId = (await created.json()).id;

      t.beforeEach(async () => {
        await sql`delete from safety_rate_limits where user_id=${ids[0]}`;
      });
      await t.test(
        "missing storage fails closed; local storage is forbidden for a remote site; scanner failure never passes",
        () => {
          moduleCheck(
            `import assert from 'node:assert/strict'; import { storage } from './lib/media/storage.ts'; import { scanPhoto } from './lib/media/process.ts'; process.env.MEDIA_STORAGE_DRIVER='none'; assert.throws(()=>storage(),e=>e.status===503); process.env.MEDIA_STORAGE_DRIVER='local'; process.env.BASE_URL='https://mimi.example'; assert.throws(()=>storage(),e=>e.status===503); const r=await scanPhoto(Buffer.from('x'),Buffer.from('x'),'fake'); assert.equal(r.status,'unavailable');`,
          );
        },
      );
      await t.test(
        "production scanner responses bind both policy checks to the exact image digest",
        () => {
          moduleCheck(
            `import assert from 'node:assert/strict'; import { scanPhoto } from './lib/media/process.ts'; process.env.MEDIA_SCAN_MODE=''; process.env.MEDIA_SCANNER_URL='https://scanner.example.test/check'; process.env.MEDIA_SCANNER_TOKEN='unit-test-only-not-a-real-credential'; const sha='fixture-digest'; let response={sha256:sha,policy:'mimi-non-explicit-v1',malware:'pass',content:'pass'}; globalThis.fetch=async()=>new Response(JSON.stringify(response),{status:200}); assert.equal((await scanPhoto(Buffer.from('fixture'),Buffer.from('thumb'),sha)).status,'passed'); for (const change of [{sha256:'other'},{policy:'other'},{malware:'fail'},{content:'fail'}]) { const old={...response}; response={...response,...change}; assert.equal((await scanPhoto(Buffer.from('fixture'),Buffer.from('thumb'),sha)).status,'rejected'); response=old; } globalThis.fetch=async()=>new Response('unavailable',{status:503}); assert.equal((await scanPhoto(Buffer.from('fixture'),Buffer.from('thumb'),sha)).status,'unavailable');`,
          );
        },
      );
      await t.test(
        "upload reservation requires session, CSRF, ownership and reviewed revision",
        async () => {
          const body = {
            action: "reserve",
            postId,
            revision: (await row()).revision,
            description: "A soft cardigan",
          };
          assert.equal((await call("/api/media", "POST", body)).status, 401);
          assert.equal(
            (
              await call("/api/media", "POST", body, 0, {
                Origin: "https://other.example",
              })
            ).status,
            403,
          );
          assert.equal((await media(body, 1)).status, 403);
          assert.equal((await media({ ...body, ownerId: ids[1] })).status, 400);
          assert.equal((await media({ ...body, revision: 99999 })).status, 409);
        },
      );
      await t.test(
        "JPEG upload strips metadata, auto-orients, creates private WebP variants and consumes authorization once",
        async () => {
          const slot = await reserve();
          mainAsset = slot.id;
          assert.equal((await read(slot.id)).status, 404);
          assert.equal((await upload(slot, jpeg, 1)).status, 404);
          assert.equal(
            (await upload({ ...slot, token: "0".repeat(64) }, jpeg)).status,
            409,
          );
          assert.equal((await upload(slot, jpeg)).status, 200);
          assert.equal((await upload(slot, jpeg)).status, 409);
          const m = await asset(slot.id);
          assert.equal(m.state, "ready");
          assert.equal(m.scan_status, "development_manual");
          assert.notEqual(m.upload_token_hash, slot.token);
          assert.match(m.display_key, /^[a-f0-9]{64}\.webp$/);
          const response = await read(slot.id, 0, "display");
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("content-type"), "image/webp");
          assert.match(response.headers.get("cache-control"), /no-store/);
          assert.equal(
            response.headers.get("cross-origin-resource-policy"),
            "same-origin",
          );
          const bytes = Buffer.from(await response.arrayBuffer()),
            meta = await sharp(bytes).metadata();
          assert.equal(meta.format, "webp");
          assert.equal(meta.width, 60);
          assert.equal(meta.height, 80);
          assert.equal(meta.exif, undefined);
          assert.equal(meta.icc, undefined);
          assert.equal(meta.orientation, undefined);
          assert.ok(!bytes.includes(Buffer.from("private-metadata-" + tag)));
          assert.equal((await read(slot.id, 1)).status, 404);
          assert.equal((await read(slot.id, 2)).status, 200);
          assert.equal((await read(slot.id)).status, 404);
          assert.equal((await read(slot.id, 0, "../original")).status, 404);
          const workspace = await (
            await call("/api/social?view=workspace", "GET", undefined, 0)
          ).json();
          assert.equal(workspace.items[0].photos[0].id, slot.id);
          assert.doesNotMatch(
            JSON.stringify(workspace),
            /display_key|thumbnail_key|upload_token|owner_id|password_hash/,
          );
        },
      );
      await t.test(
        "PNG and WebP are accepted; ordering and descriptions belong to the post owner",
        async () => {
          const one = await reserve("Peach accessories"),
            two = await reserve("Lavender stars");
          assert.equal((await upload(one, png)).status, 200);
          assert.equal((await upload(two, webp)).status, 200);
          const body = {
            action: "arrange",
            postId,
            revision: (await row()).revision,
            photos: [
              { id: two.id, description: "Stars <script>plain text</script>" },
              { id: one.id, description: "Peach accessories" },
              { id: mainAsset, description: "Lavender cardigan" },
            ],
          };
          assert.equal((await media(body, 1)).status, 403);
          assert.equal(
            (
              await media({
                ...body,
                photos: [body.photos[0], body.photos[0], body.photos[2]],
              })
            ).status,
            400,
          );
          assert.equal((await media(body)).status, 200);
          assert.equal((await asset(two.id)).position, 0);
          await remove(one.id);
          await remove(two.id);
        },
      );
      await t.test(
        "invalid, truncated, animated, executable, appended and oversized files fail before publication",
        async () => {
          const invalid = [
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            ),
            Buffer.from("MZ executable"),
            Buffer.from([255, 216, 255, 0, 255, 217]),
            png.subarray(0, png.length - 20),
            Buffer.concat([jpeg, Buffer.from("MZ")]),
            Buffer.from("GIF89a"),
            animated,
            apng,
            Buffer.alloc(10485761),
          ];
          for (const bytes of invalid) {
            const slot = await reserve("Invalid format security fixture");
            const response = await upload(slot, bytes);
            assert.ok(
              [400, 413].includes(response.status),
              await response.text(),
            );
            assert.equal((await asset(slot.id)).state, "failed");
            assert.equal((await read(slot.id, 0)).status, 404);
            await remove(slot.id);
          }
          const large = await sharp({
            create: { width: 8001, height: 1, channels: 3, background: "pink" },
          })
            .png()
            .toBuffer();
          const slot = await reserve("Dimension boundary fixture");
          assert.equal((await upload(slot, large)).status, 400);
          await remove(slot.id);
        },
      );
      await t.test(
        "incomplete/expired uploads cannot be submitted, used or approved",
        async () => {
          const slot = await reserve("An incomplete photo");
          assert.equal((await submit()).status, 409);
          await sql`update media_assets set upload_expires_at=now()-interval '1 minute' where id=${slot.id}`;
          assert.equal((await upload(slot, png)).status, 409);
          moduleCheck(
            `import { cleanupMedia } from './lib/media/cleanup.ts'; import { client } from './lib/db/drizzle.ts'; await cleanupMedia(true,${ids[0]}); await client.end();`,
          );
          const workspace = await (
            await call("/api/social?view=workspace", "GET", undefined, 0)
          ).json();
          assert.equal(
            workspace.items[0].photos.find((p) => p.id === slot.id).state,
            "purged",
          );
          await remove(slot.id);
          assert.equal((await submit()).status, 200);
          await sql`update media_assets set scan_status='unavailable' where id=${mainAsset}`;
          assert.equal((await decision()).status, 409);
          assert.equal((await read(mainAsset)).status, 404);
          await sql`update media_assets set scan_status='development_manual' where id=${mainAsset}`;
        },
      );
      await t.test(
        "expiry cleanup during an in-flight upload prevents late stored outputs",
        async () => {
          // Return the pending post to draft through its normal owner edit.
          let p = await row();
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: p.revision,
                title: p.title,
                body: p.body,
              })
            ).status,
            200,
          );
          const slot = await reserve("In-flight expiry race fixture");
          let finish;
          const release = new Promise((resolve) => {
            finish = resolve;
          });
          const body = new ReadableStream({
            async start(controller) {
              controller.enqueue(png.subarray(0, 8));
              await release;
              controller.enqueue(png.subarray(8));
              controller.close();
            },
          });
          const pending = fetch(new URL(`/api/media/${slot.id}/upload`, base), {
            method: "PUT",
            duplex: "half",
            headers: {
              Origin: new URL(base).origin,
              Cookie: cookies[0],
              "X-Upload-Token": slot.token,
              "Content-Type": "application/octet-stream",
            },
            body,
          });
          try {
            for (
              let i = 0;
              i < 100 && (await asset(slot.id)).state !== "processing";
              i++
            )
              await new Promise((resolve) => setTimeout(resolve, 20));
            assert.equal((await asset(slot.id)).state, "processing");
            await sql`update media_assets set upload_expires_at=now()-interval '1 minute' where id=${slot.id}`;
            moduleCheck(
              `import { cleanupMedia } from './lib/media/cleanup.ts'; import { client } from './lib/db/drizzle.ts'; await cleanupMedia(true,${ids[0]}); await client.end();`,
            );
          } finally {
            finish();
          }
          assert.equal((await pending).status, 409);
          const m = await asset(slot.id);
          assert.equal(m.state, "purged");
          for (const key of [m.display_key, m.thumbnail_key])
            await assert.rejects(readFile(join(root, key)), { code: "ENOENT" });
          await remove(slot.id);
          assert.equal((await submit()).status, 200);
        },
      );
      await t.test(
        "staff approval binds image publication to the exact post revision across all feeds",
        async () => {
          assert.equal((await decision()).status, 200);
          const m = await asset(mainAsset),
            p = await row();
          assert.equal(m.moderation, "approved");
          assert.equal(m.approved_revision, p.revision);
          assert.equal((await read(mainAsset)).status, 200);
          await sql`update media_assets set scan_status='unavailable' where id=${mainAsset}`;
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await feed()).length, 0);
          await sql`update media_assets set scan_status='development_manual' where id=${mainAsset}`;
          assert.equal((await feed())[0].photos[0].id, mainAsset);
          for (const scope of ["main", "home"]) {
            const items = (
              await (await call(`/api/social?scope=${scope}`)).json()
            ).items;
            assert.ok(
              items.some((p) => p.id === postId && p.photos.length === 1),
            );
          }
          await social(
            { action: "follow", username: name, following: true },
            1,
          );
          await social({ action: "save", postId, saved: true }, 1);
          for (const scope of ["saved", "following"]) {
            const items = (
              await (
                await call(`/api/social?scope=${scope}`, "GET", undefined, 1)
              ).json()
            ).items;
            assert.ok(
              items.some((p) => p.id === postId && p.photos.length === 1),
            );
          }
          const snapshot = (
            await sql`select snapshot from moderation_audit where entity_type='post' and entity_id=${postId} and action='post_approved' order by id desc limit 1`
          )[0].snapshot;
          assert.equal(snapshot.photos[0].id, mainAsset);
          assert.match(snapshot.photos[0].sha256, /^[a-f0-9]{64}$/);
          assert.doesNotMatch(
            JSON.stringify(snapshot),
            /display_key|upload_token/,
          );
        },
      );
      await t.test(
        "photo edits withdraw publication, reject stale reviews, and require new approval",
        async () => {
          const old = (await row()).revision;
          assert.equal(
            (
              await media({
                action: "arrange",
                postId,
                revision: old,
                photos: [
                  {
                    id: mainAsset,
                    description: "Updated accessible description",
                  },
                ],
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await feed()).length, 0);
          assert.equal((await row()).status, "draft");
          assert.equal((await submit()).status, 200);
          assert.equal((await decision("approve_post", old)).status, 409);
          assert.equal((await decision()).status, 200);
          const p = await row();
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: p.revision,
                title: p.title,
                body: "Edited text also withdraws the photos.",
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await submit()).status, 200);
          assert.equal((await decision("reject_post")).status, 200);
          assert.equal(
            (
              await media({
                action: "arrange",
                postId,
                revision: (await row()).revision,
                photos: [
                  { id: mainAsset, description: "Corrected after rejection" },
                ],
              })
            ).status,
            200,
          );
          assert.equal((await submit()).status, 200);
          assert.equal((await decision()).status, 200);
        },
      );
      await t.test(
        "blocks in both directions, hiding, suspension and deletion gate media and saved collections",
        async () => {
          for (const [blocker, target] of [
            [1, name],
            [0, `viewer_${tag}`],
          ]) {
            if (blocker === 0)
              await sql`insert into creator_profiles(user_id,username,display_name,biography,theme,avatar,banner,categories) select ${ids[1]},${target},display_name,biography,theme,avatar,banner,categories from creator_profiles where user_id=${ids[0]}`;
            const response = await call(
              "/api/safety",
              "POST",
              { action: "block", username: target },
              blocker,
            );
            assert.equal(response.status, 201, await response.text());
            assert.equal((await read(mainAsset, 1)).status, 404);
            assert.equal((await read(mainAsset)).status, 200);
            const [b] =
              await sql`select id from account_blocks where blocker_id=${ids[blocker]}`;
            assert.equal(
              (
                await call(
                  "/api/safety",
                  "POST",
                  { action: "unblock", blockId: b.id },
                  blocker,
                )
              ).status,
              200,
            );
          }
          for (const change of ["hidden", "suspended", "deleted"]) {
            if (change === "hidden")
              await sql`update creator_profiles set visibility='hidden' where user_id=${ids[0]}`;
            if (change === "suspended")
              await sql`update creator_profiles set moderation_status='suspended' where user_id=${ids[0]}`;
            if (change === "deleted")
              await sql`update users set deleted_at=now() where id=${ids[0]}`;
            assert.equal((await read(mainAsset)).status, 404);
            assert.equal((await read(mainAsset, 1)).status, 404);
            assert.equal(
              (
                await (
                  await call("/api/social?scope=saved", "GET", undefined, 1)
                ).json()
              ).items.length,
              0,
            );
            if (change === "suspended")
              assert.equal((await reserveDenied()).status, 403);
            await sql`update users set deleted_at=null where id=${ids[0]}`;
            await sql`update creator_profiles set visibility='listed',moderation_status='approved' where user_id=${ids[0]}`;
          }
          async function reserveDenied() {
            return media({
              action: "reserve",
              postId,
              revision: (await row()).revision,
              description: "Blocked suspended upload",
            });
          }
          assert.equal((await read(mainAsset)).status, 200);
        },
      );
      await t.test(
        "reports preserve photo evidence; removal and appeals cannot silently restore publication",
        async () => {
          const report = await social(
            {
              action: "report",
              target: "post",
              id: postId,
              reason: "Privacy violation",
              explanation: "Disposable photo report fixture.",
            },
            1,
          );
          assert.equal(report.status, 200, await report.clone().text());
          const evidence = (
            await sql`select snapshot from social_reports where post_id=${postId}`
          )[0].snapshot;
          assert.equal(evidence.photos[0].id, mainAsset);
          assert.equal((await decision("remove_post")).status, 200);
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal(
            (
              await media({
                action: "remove",
                postId,
                revision: (await row()).revision,
                assetId: mainAsset,
              })
            ).status,
            403,
          );
          const [d] =
            await sql`select id from moderation_audit where entity_id=${postId} and action='post_removed' order by id desc limit 1`;
          assert.equal(
            (
              await social({
                action: "appeal",
                decisionId: d.id,
                explanation: "Please review this disposable photo decision.",
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await decision("restore_post")).status, 200);
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await decision()).status, 200);
        },
      );
      await t.test(
        "five-photo cap and quota reservations resist concurrent requests",
        async () => {
          await sql`delete from safety_rate_limits where user_id=${ids[0]}`;
          const slots = [];
          for (let i = 0; i < 4; i++)
            slots.push(await reserve("Count limit photo"));
          assert.equal(
            (
              await media({
                action: "reserve",
                postId,
                revision: (await row()).revision,
                description: "Sixth photo",
              })
            ).status,
            409,
          );
          for (const slot of slots) await remove(slot.id);
          await sql`delete from media_assets where owner_id=${ids[0]} and state='reserved'`;
          const [existing] =
            await sql`select coalesce(sum(storage_bytes),0)::int as bytes from media_assets where owner_id=${ids[0]} and state<>'purged'`;
          const fake = randomUUID();
          await sql`insert into media_assets(id,owner_id,post_id,position,description,display_key,thumbnail_key,storage_driver,upload_token_hash,upload_expires_at,storage_bytes,deleted_at) values(${fake},${ids[0]},${postId},0,'Retained quota fixture',${randomBytes(32).toString("hex") + ".webp"},${randomBytes(32).toString("hex") + ".webp"},'local','',now(),${10485760 - existing.bytes},now())`;
          // 49 retained reservations reserve 490 MB without creating real objects.
          for (let i = 0; i < 48; i++)
            await sql`insert into media_assets(id,owner_id,post_id,position,description,display_key,thumbnail_key,storage_driver,upload_token_hash,upload_expires_at,storage_bytes,deleted_at) select ${randomUUID()},owner_id,post_id,0,description,${randomBytes(32).toString("hex") + ".webp"},${randomBytes(32).toString("hex") + ".webp"},storage_driver,'',now(),10485760,now() from media_assets where id=${fake}`;
          const rev = (await row()).revision;
          const results = await Promise.all(
            [1, 2].map(() =>
              media({
                action: "reserve",
                postId,
                revision: rev,
                description: "Concurrent quota boundary",
              }),
            ),
          );
          assert.equal(results.filter((r) => r.status === 200).length, 1);
          assert.equal(results.filter((r) => r.status === 409).length, 1);
          assert.equal(
            (
              await media({
                action: "reserve",
                postId,
                revision: (await row()).revision,
                description: "Over the owner byte quota",
              })
            ).status,
            409,
          );
          const [total] =
            await sql`select sum(storage_bytes)::bigint as bytes from media_assets where owner_id=${ids[0]} and state<>'purged'`;
          assert.ok(Number(total.bytes) <= 500 * 1024 * 1024);
          await sql`update media_assets set storage_bytes=0 where owner_id=${ids[0]} and id<>${mainAsset}`;
          const [number] =
            await sql`select count(*)::int as count from media_assets where owner_id=${ids[0]} and state<>'purged'`;
          const padding = Array.from({ length: 200 - number.count }, () => ({
            id: randomUUID(),
            owner_id: ids[0],
            post_id: postId,
            position: 0,
            description: "Asset count quota fixture",
            state: "failed",
            storage_bytes: 0,
            storage_driver: "local",
            display_key: randomBytes(32).toString("hex") + ".webp",
            thumbnail_key: randomBytes(32).toString("hex") + ".webp",
            upload_token_hash: "",
            upload_expires_at: new Date(),
            deleted_at: new Date(),
          }));
          await sql`insert into media_assets ${sql(padding)}`;
          assert.equal(
            (
              await media({
                action: "reserve",
                postId,
                revision: (await row()).revision,
                description: "Over the 200 asset count quota",
              })
            ).status,
            409,
          );
          await sql`delete from media_assets where owner_id=${ids[0]} and id<>${mainAsset} and state in ('reserved','failed')`;
        },
      );
      await t.test(
        "upload rate limits are durable; expired and withdrawn objects are cleaned without deleting history",
        async () => {
          await sql`insert into safety_rate_limits(user_id,scope,attempts,started_at) values(${ids[0]},'photo_uploads',20,now()) on conflict(user_id,scope) do update set attempts=20,started_at=now()`;
          assert.equal(
            (
              await media({
                action: "reserve",
                postId,
                revision: (await row()).revision,
                description: "Rate limited photo",
              })
            ).status,
            429,
          );
          await sql`delete from safety_rate_limits where user_id=${ids[0]}`;
          const slot = await reserve("Abandoned slot");
          const stored = await asset(mainAsset);
          const old = (await row()).revision;
          const p = await row();
          assert.equal(
            (
              await social({
                action: "delete_post",
                id: postId,
                revision: p.revision,
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          await sql`update media_assets set upload_expires_at=now()-interval '1 day' where id=${slot.id}`;
          await sql`update social_posts set deleted_at=now()-interval '31 days' where id=${postId}`;
          const invoke = (apply) =>
            JSON.parse(
              moduleCheck(
                `import { cleanupMedia } from './lib/media/cleanup.ts'; import { client } from './lib/db/drizzle.ts'; console.log(JSON.stringify(await cleanupMedia(${apply},${ids[0]}))); await client.end();`,
              )
                .trim()
                .split("\n")
                .at(-1),
            );
          const cli = execFileSync(
            process.execPath,
            [
              "--conditions=react-server",
              "--import",
              "tsx",
              "scripts/media-cleanup.ts",
              "--dry-run",
            ],
            { env: process.env, encoding: "utf8" },
          );
          assert.equal(JSON.parse(cli.trim().split("\n").at(-1)).dryRun, true);
          assert.ok(invoke(false).candidates > 0);
          assert.equal((await asset(mainAsset)).state, "ready");
          assert.ok(invoke(true).purged >= 2);
          assert.equal((await asset(mainAsset)).state, "purged");
          assert.equal((await asset(slot.id)).state, "purged");
          await assert.rejects(readFile(join(root, stored.display_key)), {
            code: "ENOENT",
          });
          assert.ok(
            (
              await sql`select id from moderation_audit where entity_type='post' and entity_id=${postId}`
            ).length > 0,
          );
          assert.ok((await row()).revision > old);
        },
      );
    } finally {
      if (ids.length) {
        const files =
          await sql`select display_key,thumbnail_key from media_assets where owner_id=any(${ids}::int[])`;
        for (const file of files)
          for (const key of [file.display_key, file.thumbnail_key])
            try {
              await unlink(join(root, key));
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
        await sql`delete from social_appeals where user_id=any(${ids}::int[])`;
        await sql`delete from social_reports where reporter_id=any(${ids}::int[])`;
        await sql`delete from media_assets where owner_id=any(${ids}::int[])`;
        await sql`delete from saved_posts where user_id=any(${ids}::int[])`;
        await sql`delete from creator_follows where follower_id=any(${ids}::int[]) or creator_id=any(${ids}::int[])`;
        await sql`delete from moderation_audit where actor_id=any(${ids}::int[]) or (entity_type='permission' and entity_id=any(${ids}::int[]))`;
        await sql`delete from social_posts where profile_id in (select id from creator_profiles where user_id=any(${ids}::int[]))`;
        await sql`delete from account_blocks where blocker_id=any(${ids}::int[]) or blocked_id=any(${ids}::int[])`;
        await sql`delete from safety_rate_limits where user_id=any(${ids}::int[])`;
        await sql`delete from creator_profiles where user_id=any(${ids}::int[])`;
        await sql`delete from platform_staff where user_id=any(${ids}::int[])`;
        await sql`delete from users where id=any(${ids}::int[])`;
      }
      await sql.end();
    }
  },
);
