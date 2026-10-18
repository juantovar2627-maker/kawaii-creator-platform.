import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  utimes,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:https";
import postgres from "postgres";
import { SignJWT } from "jose";
import { hash } from "bcryptjs";
const exec = promisify(execFile),
  base = process.env.TEST_BASE_URL,
  url = process.env.TEST_DATABASE_URL,
  secret = process.env.AUTH_SECRET;
test(
  "creator videos: quarantine, durable processing, streaming, moderation and recovery",
  { skip: !base || !url || !secret },
  async (t) => {
    for (const value of [base, url])
      assert.ok(
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname),
      );
    assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
    assert.ok(process.env.MEDIA_LOCAL_ROOT?.startsWith("/"));
    assert.ok(process.env.VIDEO_WORK_ROOT?.startsWith("/"));
    const root = process.env.MEDIA_LOCAL_ROOT,
      sql = postgres(url, { max: 4 }),
      tag = randomBytes(6).toString("hex"),
      ids = [],
      cookies = [],
      workerIds = new Set();
    const tmp = await mkdtemp(join(tmpdir(), "video-test-")),
      username = "reel_" + tag;
    let postId,
      mainAsset,
      https,
      scannerMode = "pass",
      scannerRequests = 0,
      scannerUrl,
      cert;
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
    const video = (body, who = 0) => call("/api/videos", "POST", body, who),
      social = (body, who = 0) => call("/api/social", "POST", body, who);
    const post = async (id = postId) =>
      (await sql`select * from social_posts where id=${id}`)[0];
    const asset = async (id) =>
      (await sql`select * from video_assets where id=${id}`)[0];
    const job = async (id) =>
      (await sql`select * from video_jobs where asset_id=${id}`)[0];
    const create = async (title = "A pastel short film") => {
      const r = await social({
        action: "create_post",
        title,
        body: "A non-explicit synthetic video fixture.",
      });
      assert.equal(r.status, 200, await r.clone().text());
      return (await r.json()).id;
    };
    const reserve = async (bytes, target = postId, as = 0) => {
      const r = await video(
        {
          action: "reserve",
          postId: target,
          revision: (await post(target)).revision,
          bytes: bytes.length,
          description: "A pastel illustration moving gently.",
          transcript: "A generated musical tone. No speech.",
        },
        as,
      );
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
    const upload = (slot, bytes, who = 0, headers = {}) =>
      call(`/api/videos/${slot.id}/upload`, "PUT", bytes, who, {
        "Content-Type": "application/octet-stream",
        "X-Upload-Token": slot.token,
        ...headers,
      });
    const complete = (slot, who = 0) =>
      video({ action: "complete", assetId: slot.id, token: slot.token }, who);
    const read = (id, who, headers = {}, variant = "playback") =>
      call(
        `/api/videos/${id}?variant=${variant}`,
        "GET",
        undefined,
        who,
        headers,
      );
    const prepare = async (bytes, target = postId) => {
      const slot = await reserve(bytes, target);
      assert.equal((await upload(slot, bytes)).status, 200);
      const r = await complete(slot);
      assert.equal(r.status, 200, await r.clone().text());
      return slot;
    };
    const worker = async (env = {}) => {
      const { stdout } = await exec(
        process.execPath,
        [
          "--max-old-space-size=384",
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/video-worker.ts",
          "--once",
        ],
        {
          env: { ...process.env, ...env },
          encoding: "utf8",
          timeout: 240000,
          maxBuffer: 1024 * 1024,
        },
      );
      const result = JSON.parse(stdout.trim().split("\n").at(-1));
      workerIds.add(result.workerId);
      return result;
    };
    const moduleCall = async (source, extra = {}) => {
      const { stdout } = await exec(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          source +
            '; const {client}=await import("./lib/db/drizzle.ts"); await client.end();',
        ],
        {
          env: { ...process.env, ...extra },
          encoding: "utf8",
          timeout: 240000,
          maxBuffer: 1024 * 1024,
        },
      );
      return stdout.trim();
    };
    const decide = async (action = "approve_post", revision) =>
      call(
        "/api/admin/social",
        "POST",
        {
          action,
          id: postId,
          revision: revision ?? (await post()).revision,
          reason:
            "Reviewed the complete video, audio, description and caption.",
          internalNote: "private-video-review-" + tag,
        },
        2,
      );
    const submit = async () =>
      social({
        action: "submit_post",
        id: postId,
        revision: (await post()).revision,
      });
    const clip = async (name, args = []) => {
      const path = join(tmp, name);
      await exec(
        "/usr/bin/ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=pink:s=320x240:r=24:d=2",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000:duration=2",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-shortest",
          ...args,
          path,
        ],
        { timeout: 30000 },
      );
      return readFile(path);
    };
    try {
      for (let i = 0; i < 3; i++) {
        const [u] =
          await sql`insert into users(name,email,password_hash) values(${`Video test ${i}`},${`video-${i}-${tag}@example.test`},${await hash(randomBytes(24).toString("hex"), 10)}) returning id`;
        ids.push(u.id);
        cookies.push(
          "session=" +
            (await new SignJWT({
              user: { id: u.id },
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
          "video-development-test",
          "--reason",
          "Provision temporary video review account.",
        ],
        { env: { ...process.env, POSTGRES_URL: url }, stdio: "pipe" },
      );
      await sql`insert into creator_profiles(user_id,username,display_name,biography,theme,avatar,banner,categories,visibility,moderation_status) values(${ids[0]},${username},'Pastel filmmaker','Non-explicit short videos.','pink','star','blossom','["Art & illustration"]'::jsonb,'listed','approved')`;
      postId = await create();
      const mp4 = await clip("valid.mp4", [
          "-metadata",
          "location=+37.000-122.000/",
          "-metadata",
          "title=private-source-" + tag,
          "-movflags",
          "+faststart",
        ]),
        mov = await clip("valid.mov", ["-f", "mov"]);
      const rotatedPath = join(tmp, "rotated.mov");
      await exec("/usr/bin/ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-display_rotation",
        "90",
        "-i",
        join(tmp, "valid.mov"),
        "-c",
        "copy",
        rotatedPath,
      ]);
      const rotated = await readFile(rotatedPath);
      t.beforeEach(async () => {
        await sql`delete from safety_rate_limits where user_id=any(${ids}::int[])`;
      });
      await t.test(
        "upload authorization requires session, CSRF, strict inputs, ownership, caption and current revision",
        async () => {
          const body = {
            action: "reserve",
            postId,
            revision: (await post()).revision,
            bytes: mp4.length,
            description: "A pastel clip",
          };
          assert.equal((await call("/api/videos", "POST", body)).status, 401);
          assert.equal(
            (
              await call("/api/videos", "POST", body, 0, {
                Origin: "https://other.example",
              })
            ).status,
            403,
          );
          assert.equal((await video(body, 1)).status, 403);
          assert.equal((await video({ ...body, ownerId: ids[1] })).status, 400);
          assert.equal((await video({ ...body, revision: 99999 })).status, 409);
          assert.equal(
            (await video({ ...body, bytes: 104857601 })).status,
            400,
          );
          assert.equal(
            (
              await social({
                action: "create_post",
                body: "",
                title: "No caption",
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "one-use local quarantine uploads verify actual bytes and prohibit cross-account access",
        async () => {
          const slot = await reserve(mp4);
          mainAsset = slot.id;
          assert.equal(slot.local, true);
          assert.match(slot.uploadUrl, /^\/api\/videos\//);
          assert.doesNotMatch(
            JSON.stringify(slot),
            /sourceKey|playbackKey|secretAccessKey/,
          );
          assert.equal((await upload(slot, mp4, 1)).status, 404);
          assert.equal((await complete(slot)).status, 409);
          assert.equal(
            (await upload({ ...slot, token: "0".repeat(64) }, mp4)).status,
            409,
          );
          assert.equal((await upload(slot, mp4)).status, 200);
          assert.equal((await upload(slot, mp4)).status, 409);
          assert.equal((await complete(slot, 1)).status, 404);
          assert.equal((await complete(slot)).status, 200);
          assert.equal((await complete(slot)).status, 409);
          assert.equal((await asset(slot.id)).state, "queued");
          for (const who of [undefined, 0, 1, 2])
            assert.equal((await read(slot.id, who)).status, 404);
          assert.equal((await read(slot.id, 0, {}, "source")).status, 404);
          assert.equal((await submit()).status, 409);
          assert.equal(
            (
              await call(
                "/api/media",
                "POST",
                {
                  action: "reserve",
                  postId,
                  revision: (await post()).revision,
                  description: "Cannot mix photos",
                },
                0,
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await video({
                action: "reserve",
                postId,
                revision: (await post()).revision,
                bytes: mp4.length,
                description: "Second video",
              })
            ).status,
            409,
          );
        },
      );
      await t.test(
        "real FFprobe/FFmpeg worker generates private H.264/AAC playback and poster, strips metadata and retains audit identity",
        async () => {
          const result = await worker();
          assert.equal(result.state, "succeeded", JSON.stringify(result));
          assert.equal(result.assetId, mainAsset);
          const a = await asset(mainAsset);
          assert.equal(a.state, "ready");
          assert.equal(a.video_codec, "h264");
          assert.equal(a.audio_codec, "aac");
          assert.ok(a.width <= 1280 && a.height <= 720);
          assert.ok(a.duration_ms > 0 && a.duration_ms <= 60000);
          assert.equal(a.scan_status, "development_manual");
          assert.equal(a.processor_mode, "development-prlimit");
          assert.equal((await job(mainAsset)).state, "succeeded");
          assert.match(a.sha256, /^[a-f0-9]{64}$/);
          await assert.rejects(stat(join(root, a.source_key)), {
            code: "ENOENT",
          });
          for (const who of [0, 2])
            assert.equal((await read(mainAsset, who)).status, 200);
          assert.equal((await read(mainAsset, 1)).status, 404);
          assert.equal((await read(mainAsset)).status, 404);
          const { stdout } = await exec("/usr/bin/ffprobe", [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            join(root, a.playback_key),
          ]);
          const meta = JSON.parse(stdout);
          assert.doesNotMatch(
            JSON.stringify([
              meta.format.tags,
              ...meta.streams.map((s) => s.tags),
            ]),
            /private-source-|\+37\.000|location|GPS/i,
          );
          assert.equal(
            (await read(mainAsset, 0, {}, "poster")).headers.get(
              "content-type",
            ),
            "image/webp",
          );
          const workspace = await (
            await call("/api/social?view=workspace", "GET", undefined, 0)
          ).json();
          assert.equal(workspace.items[0].video.id, mainAsset);
          assert.doesNotMatch(
            JSON.stringify(workspace),
            /source_key|playback_key|upload_token_hash|worker_id|password_hash/,
          );
        },
      );
      await t.test(
        "human review binds publication to the exact video/post version and range delivery checks authorization",
        async () => {
          assert.equal((await submit()).status, 200);
          assert.equal((await decide()).status, 200);
          const a = await asset(mainAsset);
          assert.equal(a.approved_revision, (await post()).revision);
          assert.equal(a.moderation, "approved");
          const response = await read(mainAsset);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("content-type"), "video/mp4");
          assert.match(response.headers.get("cache-control"), /no-store/);
          assert.equal(response.headers.get("accept-ranges"), "bytes");
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(bytes.length, a.playback_bytes);
          for (const [range, expected, start, end] of [
            ["bytes=0-99", 206, 0, 99],
            ["bytes=100-", 206, 100, bytes.length - 1],
            ["bytes=-64", 206, bytes.length - 64, bytes.length - 1],
          ]) {
            const r = await read(mainAsset, undefined, { Range: range });
            assert.equal(r.status, expected);
            assert.equal(
              r.headers.get("content-range"),
              `bytes ${start}-${end}/${bytes.length}`,
            );
            assert.deepEqual(
              Buffer.from(await r.arrayBuffer()),
              bytes.subarray(start, end + 1),
            );
          }
          for (const range of [
            "bytes=999999999-",
            "bytes=20-10",
            "bytes=0-1,3-5",
            "items=0-1",
          ]) {
            const r = await read(mainAsset, undefined, { Range: range });
            assert.equal(r.status, 416);
            assert.equal(
              r.headers.get("content-range"),
              `bytes */${bytes.length}`,
            );
          }
          const head = await call("/api/videos/" + mainAsset, "HEAD");
          assert.equal(head.status, 200);
          assert.equal(
            head.headers.get("content-length"),
            String(bytes.length),
          );
          assert.equal((await head.arrayBuffer()).byteLength, 0);
          for (const scope of [
            "main",
            "home",
            "creator&username=" + username,
          ]) {
            const items = (
              await (await call("/api/social?scope=" + scope)).json()
            ).items;
            assert.ok(
              items.some((p) => p.id === postId && p.video.id === mainAsset),
            );
          }
          await social({ action: "follow", username, following: true }, 1);
          await social({ action: "save", postId, saved: true }, 1);
          for (const scope of ["saved", "following"]) {
            const items = (
              await (
                await call("/api/social?scope=" + scope, "GET", undefined, 1)
              ).json()
            ).items;
            assert.ok(
              items.some((p) => p.id === postId && p.video.id === mainAsset),
            );
          }
          const snapshot = (
            await sql`select snapshot from moderation_audit where entity_type='post' and entity_id=${postId} and action='post_approved' order by id desc limit 1`
          )[0].snapshot;
          assert.equal(snapshot.video.id, mainAsset);
          assert.equal(snapshot.video.sha256, a.sha256);
          assert.doesNotMatch(
            JSON.stringify(snapshot),
            /source_key|playback_key|upload_token/,
          );
        },
      );
      await t.test(
        "text and description edits withdraw video access and stale approval cannot publish a replacement",
        async () => {
          const old = (await post()).revision;
          assert.equal(
            (
              await video({
                action: "describe",
                postId,
                revision: old,
                assetId: mainAsset,
                description:
                  "Updated pastel video description <script>plain text</script>",
                transcript: "A synthetic tone.",
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await submit()).status, 200);
          assert.equal((await decide("approve_post", old)).status, 409);
          assert.equal((await decide()).status, 200);
          const p = await post();
          assert.equal(
            (
              await social({
                action: "edit_post",
                id: postId,
                revision: p.revision,
                title: p.title,
                body: "Caption edited; a fresh review is needed.",
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await submit()).status, 200);
          assert.equal((await decide()).status, 200);
          await sql`update video_assets set scan_status='unavailable' where id=${mainAsset}`;
          assert.equal((await read(mainAsset)).status, 404);
          await sql`update video_assets set scan_status='development_manual' where id=${mainAsset}`;
        },
      );
      await t.test(
        "blocking either direction, creator visibility, suspension and deletion revoke video and saved access",
        async () => {
          await sql`insert into creator_profiles(user_id,username,display_name,biography,theme,avatar,banner,categories) values(${ids[1]},${"viewer_" + tag},'Viewer','A private fixture.','pink','star','blossom','["Lifestyle"]'::jsonb)`;
          for (const [who, target] of [
            [1, username],
            [0, "viewer_" + tag],
          ]) {
            const r = await call(
              "/api/safety",
              "POST",
              { action: "block", username: target },
              who,
            );
            assert.equal(r.status, 201);
            assert.equal(
              (await read(mainAsset, 1, { Range: "bytes=0-99" })).status,
              404,
            );
            assert.equal((await read(mainAsset)).status, 200);
            const b = (await r.json()).id;
            assert.equal(
              (
                await call(
                  "/api/safety",
                  "POST",
                  { action: "unblock", blockId: b },
                  who,
                )
              ).status,
              200,
            );
          }
          for (const state of ["hidden", "suspended", "deleted"]) {
            if (state === "hidden")
              await sql`update creator_profiles set visibility='hidden' where user_id=${ids[0]}`;
            if (state === "suspended")
              await sql`update creator_profiles set moderation_status='suspended' where user_id=${ids[0]}`;
            if (state === "deleted")
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
            await sql`update users set deleted_at=null where id=${ids[0]}`;
            await sql`update creator_profiles set visibility='listed',moderation_status='approved' where user_id=${ids[0]}`;
          }
        },
      );
      await t.test(
        "video reports retain evidence; removal, appeals and restoration preserve review boundaries",
        async () => {
          assert.equal(
            (
              await social(
                {
                  action: "report",
                  target: "post",
                  id: postId,
                  reason: "Privacy violation",
                  explanation: "Synthetic video review fixture.",
                },
                1,
              )
            ).status,
            200,
          );
          const snapshot = (
            await sql`select snapshot from social_reports where post_id=${postId}`
          )[0].snapshot;
          assert.equal(snapshot.video.id, mainAsset);
          assert.equal((await decide("remove_post")).status, 200);
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal(
            (
              await video({
                action: "remove",
                postId,
                revision: (await post()).revision,
                assetId: mainAsset,
              })
            ).status,
            403,
          );
          const [d] =
            await sql`select id from moderation_audit where entity_type='post' and entity_id=${postId} and action='post_removed' order by id desc limit 1`;
          assert.equal(
            (
              await social({
                action: "appeal",
                decisionId: d.id,
                explanation: "Please review this non-explicit synthetic video.",
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await decide("restore_post")).status, 200);
          assert.equal((await read(mainAsset)).status, 404);
          assert.equal((await decide()).status, 200);
        },
      );
      await t.test(
        "MP4/MOV codec validation rejects malformed, overlong, excessive and externally referenced structures",
        async () => {
          const referenced = Buffer.from(mp4);
          const ref = referenced.indexOf(Buffer.from("url "));
          assert.ok(ref > 0);
          assert.equal(referenced.readUInt32BE(ref + 4), 1);
          referenced.writeUInt32BE(0, ref + 4);
          const invalid = [
            referenced,
            Buffer.from("not a media file"),
            Buffer.from("<svg>unsupported</svg>"),
            mp4.subarray(0, 32),
            Buffer.concat([mp4, Buffer.from("executable trailing bytes")]),
          ];
          const mpeg = await clip("unsupported.mp4", ["-c:v", "mpeg4"]);
          invalid.push(mpeg);
          for (const bytes of invalid) {
            await sql`delete from safety_rate_limits where user_id=${ids[0]} and scope='video_reservations'`;
            const id = await create("Invalid format fixture");
            const slot = await prepare(bytes, id);
            const result = await worker();
            assert.equal(result.assetId, slot.id);
            assert.equal(result.state, "failed", JSON.stringify(result));
            assert.equal((await read(slot.id, 0)).status, 404);
            await sql`update video_assets set state='purged',storage_bytes=0,deleted_at=now() where id=${slot.id}`;
          }
          await sql`delete from safety_rate_limits where user_id=${ids[0]} and scope='video_reservations'`;
          const id = await create("QuickTime fixture"),
            slot = await prepare(rotated, id);
          const result = await worker();
          assert.equal(result.assetId, slot.id);
          assert.equal(result.state, "succeeded", JSON.stringify(result));
          assert.ok(
            (await asset(slot.id)).height > (await asset(slot.id)).width,
            "QuickTime display rotation is applied to playback",
          );
          for (const [name, source] of [
            ["long.mp4", "color=c=lavender:s=80x60:r=12:d=61"],
            ["large.mp4", "color=c=lavender:s=2048x1080:r=1:d=1"],
            ["fast.mp4", "color=c=lavender:s=80x60:r=120:d=1"],
          ]) {
            const path = join(tmp, name);
            await exec("/usr/bin/ffmpeg", [
              "-v",
              "error",
              "-nostdin",
              "-y",
              "-f",
              "lavfi",
              "-i",
              source,
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              path,
            ]);
            await sql`delete from safety_rate_limits where user_id=${ids[0]} and scope='video_reservations'`;
            const bytes = await readFile(path),
              target = await create(name),
              uploadSlot = await prepare(bytes, target),
              r = await worker();
            assert.equal(r.assetId, uploadSlot.id);
            assert.equal(r.state, "failed", JSON.stringify(r));
          }
        },
      );
      await t.test(
        "expired/oversized reservations, photo mixing, upload quotas and durable rates fail safely",
        async () => {
          const id = await create("Expiry fixture"),
            slot = await reserve(mp4, id);
          await sql`update video_assets set upload_expires_at=now()-interval '1 minute' where id=${slot.id}`;
          assert.equal((await upload(slot, mp4)).status, 409);
          assert.equal((await complete(slot)).status, 409);
          const p = await post(id);
          assert.equal(
            (
              await video({
                action: "reserve",
                postId: id,
                revision: p.revision,
                bytes: 104857601,
                description: "Too large",
              })
            ).status,
            400,
          );
          // Existing invalid/retained videos exhaust the ten-asset cap; known fixture
          // tombstones may be purged without touching another account's rows.
          await sql`update video_assets set state='purged',storage_bytes=0,deleted_at=coalesce(deleted_at,now()) where owner_id=${ids[0]} and id<>${mainAsset}`;
          const target = await create("Actual upload size fixture"),
            short = await reserve(mp4, target);
          assert.equal(
            (await upload(short, Buffer.concat([mp4, Buffer.from("x")])))
              .status,
            413,
          );
          const photoPost = await create("Photo-first mixed media guard");
          const photoSlot = await call(
            "/api/media",
            "POST",
            {
              action: "reserve",
              postId: photoPost,
              revision: (await post(photoPost)).revision,
              description: "A photo slot prevents video mixing",
            },
            0,
          );
          assert.equal(photoSlot.status, 200);
          assert.equal(
            (
              await video({
                action: "reserve",
                postId: photoPost,
                revision: (await post(photoPost)).revision,
                bytes: mp4.length,
                description: "Cannot mix",
              })
            ).status,
            409,
          );
          const current =
            await sql`select count(*)::int as count from video_assets where owner_id=${ids[0]} and state<>'purged'`;
          const padding = [];
          for (let i = 0; i < 10 - current[0].count; i++) {
            const a = {
              id: randomUUID(),
              owner_id: ids[0],
              post_id: postId,
              description: "Retained quota fixture",
              state: "failed",
              source_key: randomBytes(32).toString("hex") + ".bin",
              playback_key: randomBytes(32).toString("hex") + ".mp4",
              poster_key: randomBytes(32).toString("hex") + ".webp",
              storage_driver: "local",
              upload_token_hash: "",
              upload_expires_at: new Date(),
              expected_bytes: 1,
              storage_bytes: 209715200,
              deleted_at: new Date(),
            };
            padding.push(a);
          }
          await sql`insert into video_assets ${sql(padding)}`;
          const quotaPost = await create("Retained quota check");
          assert.equal(
            (
              await video({
                action: "reserve",
                postId: quotaPost,
                revision: (await post(quotaPost)).revision,
                bytes: mp4.length,
                description: "Count quota denied",
              })
            ).status,
            409,
          );
          await sql`delete from video_assets where id=${padding[0].id}`;
          const extraPhotos = [];
          for (let i = 0; i < 49; i++)
            extraPhotos.push({
              id: randomUUID(),
              owner_id: ids[0],
              post_id: postId,
              position: 0,
              description: "Photo quota fixture",
              state: "failed",
              display_key: randomBytes(32).toString("hex") + ".webp",
              thumbnail_key: randomBytes(32).toString("hex") + ".webp",
              storage_driver: "local",
              upload_token_hash: "",
              upload_expires_at: new Date(),
              storage_bytes: 10485760,
              deleted_at: new Date(),
            });
          await sql`insert into media_assets ${sql(extraPhotos)}`;
          assert.equal(
            (
              await video({
                action: "reserve",
                postId: quotaPost,
                revision: (await post(quotaPost)).revision,
                bytes: mp4.length,
                description: "Combined byte quota denied",
              })
            ).status,
            409,
          );
          await sql`delete from video_assets where id=any(${padding.map((p) => p.id)}::uuid[])`;
          await sql`delete from media_assets where id=any(${extraPhotos.map((p) => p.id)}::uuid[])`;
          await sql`insert into safety_rate_limits(user_id,scope,attempts,started_at) values(${ids[0]},'video_reservations',5,now()) on conflict(user_id,scope) do update set attempts=5,started_at=now()`;
          const fresh = await create("Rate fixture");
          assert.equal(
            (
              await video({
                action: "reserve",
                postId: fresh,
                revision: (await post(fresh)).revision,
                bytes: mp4.length,
                description: "Rate limited",
              })
            ).status,
            429,
          );
        },
      );
      await t.test(
        "maximum-duration silent video processes and production isolation never falls back silently",
        async () => {
          const path = join(tmp, "boundary.mp4");
          await exec("/usr/bin/ffmpeg", [
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=lavender:s=80x60:r=12:d=60",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            path,
          ]);
          const target = await create("Sixty-second silent clip"),
            slot = await prepare(await readFile(path), target),
            result = await worker();
          assert.equal(result.assetId, slot.id);
          assert.equal(result.state, "succeeded", JSON.stringify(result));
          assert.equal((await asset(slot.id)).duration_ms, 60000);
          assert.equal((await asset(slot.id)).audio_codec, null);
          await moduleCall(
            `import assert from 'node:assert/strict';import {processingMode} from './lib/video/process.ts';process.env.MEDIA_STORAGE_DRIVER='s3';process.env.BASE_URL='https://remote.example';process.env.VIDEO_SANDBOX_MODE='development-prlimit';assert.throws(()=>processingMode(),e=>e.code==='isolated_worker_required');`,
          );
          const isolatedTarget = await create("Isolated runtime check"),
            isolated = await prepare(mp4, isolatedTarget),
            native = await worker({ VIDEO_SANDBOX_MODE: "bwrap" });
          assert.equal(native.assetId, isolated.id);
          if (native.state === "succeeded")
            assert.equal((await asset(isolated.id)).processor_mode, "bwrap");
          else {
            assert.ok(
              ["isolated_decode_failed", "worker_runtime_unavailable"].includes(
                native.code,
              ),
              JSON.stringify(native),
            );
            console.log(
              "Production Bubblewrap execution unavailable here; default worker stayed private and did not fall back.",
            );
          }
          assert.equal((await read(isolated.id)).status, 404);
          assert.equal(
            (
              await video({
                action: "remove",
                postId: isolatedTarget,
                revision: (await post(isolatedTarget)).revision,
                assetId: isolated.id,
              })
            ).status,
            200,
          );
        },
      );
      await t.test(
        "scanner rejection/downtime and worker crash leases cannot publish media or retry without bounds",
        async () => {
          // Use a trusted local TLS protocol stub, not a real classifier or pass claim.
          await exec(
            "/usr/bin/openssl",
            [
              "req",
              "-x509",
              "-newkey",
              "rsa:2048",
              "-nodes",
              "-keyout",
              join(tmp, "key.pem"),
              "-out",
              join(tmp, "cert.pem"),
              "-days",
              "1",
              "-subj",
              "/CN=127.0.0.1",
              "-addext",
              "subjectAltName=IP:127.0.0.1",
            ],
            { timeout: 15000 },
          );
          cert = join(tmp, "cert.pem");
          const scannerToken = randomBytes(32).toString("hex");
          https = createServer(
            {
              key: await readFile(join(tmp, "key.pem")),
              cert: await readFile(cert),
            },
            async (req, res) => {
              try {
                assert.equal(
                  req.headers.authorization,
                  "Bearer " + scannerToken,
                );
                const h = createHash("sha256");
                let n = 0;
                for await (const part of req) {
                  n += part.length;
                  assert.ok(n <= 104857600);
                  h.update(part);
                }
                scannerRequests++;
                if (scannerMode === "downtime") {
                  res.writeHead(503);
                  res.end("unavailable");
                  return;
                }
                assert.equal(h.digest("hex"), req.headers["x-content-sha256"]);
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    sha256: req.headers["x-content-sha256"],
                    policy: "mimi-video-non-explicit-v1",
                    malware: "pass",
                    content: scannerMode === "reject" ? "reject" : "pass",
                    frames: scannerMode === "partial" ? "sampled" : "all",
                    audio:
                      req.headers["x-has-audio"] === "true" ? "all" : "none",
                    complete: true,
                  }),
                );
              } catch {
                res.writeHead(500);
                res.end();
              }
            },
          );
          await new Promise((resolve) => https.listen(0, "127.0.0.1", resolve));
          scannerUrl = `https://127.0.0.1:${https.address().port}/scan`;
          const env = {
            MEDIA_SCAN_MODE: "",
            VIDEO_SCANNER_URL: scannerUrl,
            VIDEO_SCANNER_TOKEN: scannerToken,
            NODE_EXTRA_CA_CERTS: cert,
          };
          const rejectId = await create("Scanner rejection"),
            rejected = await prepare(mp4, rejectId);
          scannerMode = "reject";
          const r = await worker(env);
          assert.equal(r.assetId, rejected.id);
          assert.equal(r.state, "failed");
          assert.equal((await asset(rejected.id)).scan_status, "rejected");
          assert.equal((await read(rejected.id, 0)).status, 404);
          const downId = await create("Scanner downtime"),
            down = await prepare(mp4, downId);
          scannerMode = "downtime";
          for (let i = 1; i <= 3; i++) {
            const attempt = await worker(env);
            assert.equal(attempt.assetId, down.id);
            assert.equal(
              attempt.state,
              i < 3 ? "queued" : "failed",
              JSON.stringify(attempt),
            );
            assert.equal((await job(down.id)).attempts, i);
            assert.equal((await read(down.id)).status, 404);
            await sql`update video_jobs set available_at=now() where asset_id=${down.id}`;
          }
          const idle = await worker(env);
          assert.equal(idle.jobId, null);
          assert.ok(scannerRequests >= 4);
          const partialId = await create("Incomplete scan coverage"),
            partial = await prepare(mp4, partialId);
          scannerMode = "partial";
          const coverage = await worker(env);
          assert.equal(coverage.assetId, partial.id);
          assert.equal(coverage.state, "failed");
          assert.equal((await asset(partial.id)).scan_status, "rejected");
          assert.equal((await read(partial.id)).status, 404);
          const crashId = await create("Crash recovery"),
            crash = await prepare(mp4, crashId);
          const child = spawn(
            process.execPath,
            [
              "--max-old-space-size=384",
              "--conditions=react-server",
              "--import",
              "tsx",
              "scripts/video-worker.ts",
              "--once",
            ],
            { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
          );
          let observed;
          for (let i = 0; i < 200; i++) {
            observed = await job(crash.id);
            if (observed.state === "running") break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(observed.state, "running");
          workerIds.add(observed.worker_id);
          child.kill("SIGKILL");
          await new Promise((resolve) => child.once("close", resolve));
          await sql`update video_jobs set lease_expires_at=now()-interval '1 minute' where asset_id=${crash.id}`;
          const recovered = await worker();
          assert.equal(recovered.assetId, crash.id);
          assert.equal(recovered.state, "succeeded", JSON.stringify(recovered));
          assert.equal((await job(crash.id)).attempts, 2);
        },
      );
      await t.test(
        "cleanup removes expired quarantine and stale work, retries storage failures, and preserves audit history",
        async () => {
          const id = await create("Cleanup fixture"),
            slot = await reserve(mp4, id),
            a = await asset(slot.id);
          await sql`update video_assets set upload_expires_at=now()-interval '1 hour' where id=${slot.id}`;
          const invoke = async (apply) =>
            JSON.parse(
              (
                await moduleCall(
                  `import {cleanupVideos} from './lib/video/cleanup.ts';console.log(JSON.stringify(await cleanupVideos(${apply},${ids[0]})));`,
                )
              )
                .split("\n")
                .at(-1),
            );
          assert.ok((await invoke(false)).candidates > 0);
          assert.equal((await asset(slot.id)).state, "reserved");
          await invoke(true);
          assert.equal((await asset(slot.id)).state, "purged");
          const main = await asset(mainAsset);
          assert.equal(
            (
              await social({
                action: "delete_post",
                id: postId,
                revision: (await post()).revision,
              })
            ).status,
            200,
          );
          assert.equal((await read(mainAsset)).status, 404);
          await sql`update social_posts set deleted_at=now()-interval '31 days' where id=${postId}`;
          const output = join(root, main.playback_key),
            backup = await readFile(output);
          await rm(output);
          await mkdir(output);
          await assert.rejects(invoke(true));
          assert.notEqual((await asset(mainAsset)).state, "purged");
          await rm(output, { recursive: true });
          await writeFile(output, backup, { mode: 0o600 });
          await invoke(true);
          assert.equal((await asset(mainAsset)).state, "purged");
          await assert.rejects(stat(output), { code: "ENOENT" });
          assert.ok(
            (
              await sql`select id from moderation_audit where entity_type='post' and entity_id=${postId}`
            ).length > 0,
          );
          const [j] =
            await sql`select j.* from video_jobs j join video_assets v on v.id=j.asset_id where v.owner_id=${ids[0]} limit 1`;
          const work = join(
            process.env.VIDEO_WORK_ROOT,
            `${j.id}-${randomUUID()}`,
          );
          await mkdir(work, { recursive: true, mode: 0o700 });
          await writeFile(join(work, "partial.tmp"), "fixture");
          await utimes(
            work,
            new Date(Date.now() - 3600000),
            new Date(Date.now() - 3600000),
          );
          const workResult = JSON.parse(
            (
              await moduleCall(
                `import {cleanupVideoWork} from './lib/video/cleanup.ts';console.log(JSON.stringify(await cleanupVideoWork(true,${ids[0]})));`,
              )
            )
              .split("\n")
              .at(-1),
          );
          assert.ok(workResult.removed >= 1);
          await assert.rejects(stat(work), { code: "ENOENT" });
        },
      );
    } finally {
      if (https) await new Promise((resolve) => https.close(resolve));
      if (ids.length) {
        const photos =
          await sql`select display_key,thumbnail_key from media_assets where owner_id=any(${ids}::int[])`;
        for (const p of photos)
          for (const key of [p.display_key, p.thumbnail_key])
            await rm(join(root, key), { force: true });
        await sql`delete from media_assets where owner_id=any(${ids}::int[])`;
        const objects =
          await sql`select source_key,playback_key,poster_key from video_assets where owner_id=any(${ids}::int[])`;
        for (const a of objects)
          for (const key of [a.source_key, a.playback_key, a.poster_key])
            await rm(join(root, key), { force: true, recursive: true });
        const jobRows =
          await sql`select id from video_jobs where asset_id in(select id from video_assets where owner_id=any(${ids}::int[]))`;
        const { readdir } = await import("node:fs/promises");
        for (const name of await readdir(process.env.VIDEO_WORK_ROOT))
          if (jobRows.some((j) => name.startsWith(j.id + "-")))
            await rm(join(process.env.VIDEO_WORK_ROOT, name), {
              recursive: true,
              force: true,
            });
        const tracked =
          await sql`select worker_id from video_jobs where asset_id in(select id from video_assets where owner_id=any(${ids}::int[]))`;
        for (const w of tracked) if (w.worker_id) workerIds.add(w.worker_id);
        await sql`delete from social_appeals where user_id=any(${ids}::int[])`;
        await sql`delete from social_reports where reporter_id=any(${ids}::int[])`;
        await sql`delete from video_jobs where asset_id in(select id from video_assets where owner_id=any(${ids}::int[]))`;
        await sql`delete from video_assets where owner_id=any(${ids}::int[])`;
        if (workerIds.size)
          await sql`delete from video_workers where id=any(${[...workerIds]}::uuid[])`;
        await sql`delete from saved_posts where user_id=any(${ids}::int[])`;
        await sql`delete from creator_follows where follower_id=any(${ids}::int[]) or creator_id=any(${ids}::int[])`;
        await sql`delete from moderation_audit where actor_id=any(${ids}::int[]) or (entity_type='permission' and entity_id=any(${ids}::int[]))`;
        await sql`delete from social_posts where profile_id in(select id from creator_profiles where user_id=any(${ids}::int[]))`;
        await sql`delete from account_blocks where blocker_id=any(${ids}::int[]) or blocked_id=any(${ids}::int[])`;
        await sql`delete from safety_rate_limits where user_id=any(${ids}::int[])`;
        await sql`delete from creator_profiles where user_id=any(${ids}::int[])`;
        await sql`delete from platform_staff where user_id=any(${ids}::int[])`;
        await sql`delete from users where id=any(${ids}::int[])`;
      }
      await sql.end();
      await rm(tmp, { recursive: true, force: true });
    }
  },
);
