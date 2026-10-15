# Phase 3B: private creator videos

Mimi supports one short video per real creator post, with required text caption,
optional title, required accessible description and optional plain-text transcript.
Photos and videos cannot share a post. The six fictional demo creators remain
separate. Authentication, PostgreSQL, staff permissions and disabled payments are
preserved. Nothing in this phase deploys the application or enables Stripe.

## Creator and viewer behavior

The existing post workspace has a video editor with selection, real upload
progress, errors, remove/replace, description/transcript editing, processing
status polling and private processed previews. Processing happens asynchronously;
upload completion does not mean scanning or approval. Existing submission,
withdrawal, author feedback, rejection, reporting, removal and appeals also apply
to video posts. An edit withdraws publication and invalidates previous approval.
Replacing a video requires new processing, scanning and staff review.

Approved videos appear on Home, Feed, Following, creator profiles and Saved.
Native controls support manual playback; there is no autoplay. The explicit
muted-preview button starts only that video and pauses other videos on the page.
Cards show posters, duration, loading/error states and readable descriptions and
transcripts. Staff can play protected processed media before deciding. Original
uploads never have a delivery endpoint.

## Limits and formats

- Input: MP4/MOV ISO BMFF, at most **100 MiB (104,857,600 bytes)** and 60 seconds.
- One H.264 or HEVC video stream; zero or one AAC, MP3, PCM s16le/s24le audio
  stream, mono/stereo, 8–96 kHz. No subtitles, attachments, chapters or data tracks.
- At most 1920 on either axis, 1920×1080 pixels, 60 fps and 3,600 declared frames.
  Quarter-turn display rotation is applied when producing playback.
- Output: H.264/yuv420p MP4, optional AAC stereo/48 kHz audio, at most 30 fps,
  1280×720 landscape or 720×1280 portrait, without upscaling. WebP poster ≤480px.
  Source location/title/comments and other copied metadata are removed.
- Complete input decoding is required; the worker does not truncate with `-t`.
  Input duration is strictly ≤60 seconds. Output mux/audio padding may extend the
  container to 60.1 seconds, while its video stream remains ≤60 seconds. Reported
  duration is capped at 60 seconds; output/input durations must agree within 1s.
- Playback is capped at 90 MiB and poster at 2 MiB. Browser metadata and MIME
  declarations do not determine acceptance.

The bounded container walker rejects malformed/trailing structures, fragments,
reference movies and non-self-contained media references before FFmpeg runs.
Decoding/format success is **not** a content-safety verdict.

## Upload protocol and storage

Reuse the existing private `MEDIA_STORAGE_DRIVER=s3` adapter and R2-compatible
credentials. The browser never receives permanent credentials. The application
commits a reservation, unpredictable keys and a hashed completion token before
requesting provider authorization, so crashes retain enough identity for cleanup.

Production uploads use a **single-part multipart upload**. A 15-minute presigned
`UploadPart` URL authorizes only part 1 of that upload/key and signs its exact
`Content-Length`. The browser sends the video directly to private quarantine
storage; Next.js does not proxy its body. The authenticated completion command
checks ownership, expiration, token, draft state and provider `ListParts` size,
then completes the multipart upload and checks `HeadObject` size before queuing.
The ETag pins the verified part. Completion consumes the upload ID; replay cannot
overwrite the completed object. A crash between provider completion and database
commit can recover using the recorded immutable key and actual object size.

The part URL remains a retryable bearer authorization until completion/expiry;
it is not a single-use HTTP PUT before completion. It can resend the same scoped
part within that window. Application issuance rates and quotas bound new
reservations, but provider ingress/request limits and abuse monitoring are also
operational requirements. Multipart resumability across multiple parts is deferred.

Keep the bucket private: no public domain, anonymous read/list policy or public
ACL. Required scoped provider permissions include create/upload/list-parts/
complete/abort multipart, exact-prefix list-multipart for crash recovery, and
head/get/put/delete objects. Cleanup lists only the recorded unpredictable source
key and fails rather than ignoring truncated results. Configure bucket CORS for
the exact website origin, PUT, and the signed headers (including Content-Type
where applicable); test the actual browser/provider combination before release.
Do not place storage secrets in `NEXT_PUBLIC_` variables. A live R2 account was
not used during validation; the S3 protocol tests use an isolated HTTPS fixture.

Unconfigured storage fails closed. A full-body local upload endpoint exists only
for the explicitly selected local adapter with loopback `BASE_URL`, a private
absolute storage root outside the repository, session authorization and exact
byte verification. It cannot be used with the production S3 adapter.

Rates are persistent: 30 video commands/minute, 5 reservations/hour and 10 local
binary upload attempts/hour per account. Each reservation charges 200 MiB until
actual retained sizes are known. Ten retained video assets and 2 GiB combined
photo/video storage are allowed per owner, including soft-deleted retained assets.
The existing 200-photo/500 MiB photo quota remains. Shared owner advisory locks
prevent concurrent photo/video reservation races. Removed files continue counting
until physical cleanup succeeds.

## Durable queue and separate worker

Migration `0006_sudden_sue_storm.sql` adds `video_assets`, `video_jobs` and
`video_workers`, constraints and indexes. It does not rewrite or drop existing
account, profile, post or photo tables. Apply only to a development database while
reviewing this phase. No production database was migrated.

Run `pnpm video:worker` under a process supervisor, separately from Next.js.
`pnpm video:worker --once` claims at most one available job and exits. PostgreSQL
stores states, worker heartbeat, attempt count and lease identity. A transaction
with `SKIP LOCKED` and an advisory capacity gate allows at most two live jobs
across workers. Leases last 90 seconds, renew every 15 seconds, and permit at most
three attempts, with 30/60 second retry backoff. An expired lease can be reclaimed;
exhausted jobs fail privately. Whole-job timeout is 420 seconds. Losing a lease
aborts native processing and prevents a stale worker from committing results.

The worker downloads the bounded private source to a private job/lease directory,
probes, fully transcodes, re-probes output, creates a poster and sends the entire
processed MP4 to the scanner. Only then can the asset become privately ready.
Generated writes hold asset/job locks so cleanup cannot race late writes. Source
removal happens **after** the ready/job-success commit; a crash before commit
retains input for a real retry. Failed source deletion retains quota/references
for cleanup retry. Errors exposed to creators are generic and do not leak native
diagnostics or storage details.

### Native isolation

Production defaults to `VIDEO_SANDBOX_MODE=bwrap`: Bubblewrap unshares namespaces,
including networking, clears the environment, exposes read-only runtime/source
mounts and a single writable output file, and bounds temporary filesystems.
FFmpeg/FFprobe receive only generated argument arrays, no shell interpolation or
user URLs. Child processes do not inherit database/storage/scanner secrets.
`prlimit` bounds native virtual address space to 2 GiB, file size to 90 MiB,
open files to 128, processes to 512, and CPU time to 180 seconds for transcoding
or 15 seconds for probing/poster generation. Threads/filter threads are bounded;
wall timers kill the process group, and diagnostic/output buffers are capped.

This cloud environment prohibits nested user namespace mapping, so **production
Bubblewrap execution could not be validated here**. The production worker was
verified to fail closed and never silently fall back. Real FFmpeg/FFprobe
integration tests ran on synthetic fixtures using explicitly selected
`development-prlimit`, allowed only with local storage and a loopback site.
That development mode has resource limits but **does not isolate the filesystem
or network**. Never use it for untrusted uploads or a publicly reachable service.
Production requires a patched, dedicated worker runtime that permits Bubblewrap,
plus container/cgroup limits and tested filesystem/network isolation. The app
build does not require FFmpeg, a worker, storage credentials or scanner secrets.

## Scanning contract and human moderation

`VIDEO_SCANNER_URL` must be a trusted HTTPS service, with server-only
`VIDEO_SCANNER_TOKEN`. Redirects are rejected. The adapter POSTs the complete
processed MP4 as `video/mp4`, with Content-Length, Bearer authorization,
`X-Content-SHA256`, `X-Mimi-Policy: mimi-video-non-explicit-v1` and
`X-Has-Audio: true|false`. Responses are bounded to 8 KiB and 45 seconds:

```json
{
  "sha256": "the exact submitted playback SHA-256",
  "policy": "mimi-video-non-explicit-v1",
  "malware": "pass",
  "content": "pass",
  "frames": "all",
  "audio": "all",
  "complete": true
}
```

For a silent clip, audio must be `none`. Missing/mismatched policy, digest,
coverage or verdict rejects the scan; unavailable/malformed services cause bounded
private retries. A sampled-frame or partial-audio verdict does not qualify.
The vetted provider must actually assess **all decoded frames and all audio**
against the non-explicit policy and inspect malware; these response fields are a
contract, not proof of classifier quality. No real scanner is bundled or
certified, and protocol tests are not evidence of classification accuracy. Vet
provider coverage, language support, privacy/retention, adversarial failure modes
and policy quality before production. Transcoding strips unnecessary source
metadata and rejects unsafe structures, but is not a malware classifier.
Scanning cannot establish consent, age, ownership or legality; staff procedures
and escalation remain necessary.

Only local `MEDIA_SCAN_MODE=development-manual` fixtures may bypass the external
scanner; they are visibly labeled **not content-scanned**, not fabricated passes.
Production approval requires scan passed, a succeeded job, `bwrap` processor mode
and authorized human review. Approval binds the post revision to the specific
asset identity/hash. Staff reports/audits preserve safe video snapshots without
keys/tokens/private account information. Restoring removed content does not
silently republish it; fresh approval is required. Existing staff provisioning
and authorization rules are unchanged.

## Protected playback and retention

`GET`/`HEAD /api/videos/:id` serves processed MP4; `?variant=poster` serves WebP.
Owner/staff preview and every public request use server-side access checks.
Public access requires current approved post/asset revision, passed scan (or the
local-only development exception), successful processing, eligible creator and
visibility, and no block/suspension/deletion. Saved posts use the same checks.
Unknown, inaccessible and raw-source requests return 404. No original object
keys, upload tokens or private account fields are exposed in public DTOs.

Streaming uses 200/206 with exact Content-Length/Content-Range and single byte
ranges, including open and suffix ranges; invalid/multiple ranges return 416.
Responses are private/no-store, vary by Cookie, and include nosniff and same-origin
resource restrictions. S3/local reads stream instead of loading playback into
application memory. Revocation gates new requests; already downloaded bytes cannot
be recalled. Blocking affects signed-in account access and does not turn an
otherwise public profile into a secret from anonymous visitors.

Use the existing `pnpm media:cleanup --dry-run` / `--apply` command. It now reports
video objects and worker directories alongside existing photo cleanup. Schedule
bounded apply runs (for example every five minutes), monitor errors and repeat
while `morePossible` is true. No cron/deployment was installed by this phase.

- Expired unfinished reservations: 15 minutes.
- Failed/cancelled jobs: one hour after last update.
- Abandoned queued jobs or stale running leases: 24 hours.
- Soft-deleted video/post/account media: 30 days, matching Phase 3A evidence policy.
- Successful originals: delete after commit, with cleanup retry on failure.
- Stale non-active worker directories: after 30 minutes; bounded directory scans.

Known object keys remain recorded until provider deletion succeeds. Cleanup
failures retain database references/quota for retry; no detached late worker can
publish or silently restore objects. Retained metadata/audits are not erased by
object purge. There is no legal-hold UI: review retention/legal obligations and
pause cleanup where a hold is necessary. Bucket versions/backups/provider
retention and incomplete-multipart lifecycle rules must align with this policy;
provider storage reconciliation/monitoring is still an operator responsibility.

## Local setup

Use Node 24 (or the supported Node 22.18+ toolchain), pnpm 9.15.9, development
PostgreSQL, FFmpeg/FFprobe with libx264/AAC, and Linux `prlimit`. Keep
`PAYMENTS_ENABLED=false`; do not set Stripe credentials. Copy `.env.example`,
configure the existing auth/database settings and add synthetic-fixture settings:

```dotenv
BASE_URL=http://127.0.0.1:3000
MEDIA_STORAGE_DRIVER=local
MEDIA_LOCAL_ROOT=/absolute/private/path/mimi-media
MEDIA_SCAN_MODE=development-manual
VIDEO_WORK_ROOT=/absolute/private/path/mimi-video-work
VIDEO_SANDBOX_MODE=development-prlimit
```

Both roots must be outside the repository with private permissions. Use only
synthetic fixtures, bind the app to loopback, and give the app/worker/cleanup the
same environment:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev --hostname 127.0.0.1
# Separate terminal, same environment:
pnpm video:worker
pnpm media:cleanup --dry-run
```

Optional `VIDEO_FFMPEG_PATH` / `VIDEO_FFPROBE_PATH` override absolute binary paths
(default `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`). Production uses the existing
`MEDIA_S3_*` settings, a private `VIDEO_WORK_ROOT`, default `bwrap` and the scanner
URL/token above. Photo scanning retains its separate `MEDIA_SCANNER_*` contract.
Leave uploads unconfigured to keep them safely unavailable during website work.

## Verification

Validation uses disposable accounts, synthetic videos and a loopback development
database, never real user uploads or production data. Commands:

```sh
pnpm build
pnpm typecheck
pnpm db:migrate
# App and test process must share local storage, scanning and work settings.
TEST_BASE_URL=http://127.0.0.1:3000 \
TEST_DATABASE_URL=postgres://your-local-development-database \
node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs
```

The video tests cover real FFmpeg/FFprobe MP4/MOV processing, rotated QuickTime,
metadata removal, silent maximum-duration media, invalid structures/codecs/limits,
ownership/expiration/replay, quotas/rates/mixing, review/revisions/privacy across
feeds, range delivery, block/suspension/deletion, removal/appeals, scanner rejection/
downtime/partial coverage, real worker termination/lease recovery and cleanup
failure. The S3 fixture checks scoped signed uploads, size verification, consumed
multipart authorization, range reads and crash-recovery cleanup without live
cloud credentials. Existing auth/profile/moderation/social/photo/demo/payment
tests remain part of the full run. Integration tests skip when their explicit
local database/base URL prerequisites are absent; use the configured run above.

Validated on the feature branch:

- `pnpm build`: pass without Stripe, S3 or scanner credentials; Google Fonts
  downloads succeed with the environment's trusted system CA configuration.
- `pnpm typecheck`: pass.
- `pnpm db:migrate`: additive development migration and repeat run pass.
- Configured full test run: **86 passed, 0 failed, 0 skipped**.
- Multi-account Chromium checks: real upload progress/failure recovery, MP4/MOV
  playback and HTTP ranges, owner/staff/public boundaries, all five feed surfaces,
  saved persistence, replacement/edit reapproval, single-player behavior,
  transcripts, reports and blocking pass.
- Video 13 + photo 11 + social 11 + creator profile 10 + moderation 12 = **57**
  clean desktop/mobile axe states (WCAG A/AA tags), with no browser errors or
  horizontal overflow. The older moderation helper waits for metadata/page
  refresh completion before auditing, after an initial run observed a transient
  empty title during refresh; the accessibility assertions remain enabled.
- Existing photo upload/reorder/review, real text/social flows, profile
  registration/ownership/visibility and staff safety workflows pass in browsers.
  The original Mimi browser checks also pass registration, account/profile
  updates, password changes, sign-out/new-password login, demo interactions,
  disabled memberships, mobile navigation and unknown-creator 404 behavior.

These checks do not validate a live storage provider, a real content classifier,
production namespace isolation, sustained production load or complete accessibility
conformance. The production isolation limitation above remains a release prerequisite.

## Operational prerequisites and deferred scope

This is ready for development review, not an automatic production enablement.
Before accepting public uploads, validate the actual R2 provider/CORS/IAM/bucket
privacy, deploy a vetted scanner and staff procedures, and validate the isolated
worker on the target Linux runtime. Provision supervision, cleanup scheduling,
monitoring of queue age/retries/disk/storage/scanner failures, and resource budgets.

Each active native process has two encode threads and up to 2 GiB virtual address
space, separate from the Node worker's 384 MiB heap limit and native buffers.
Plan at least roughly 2 vCPU / 3 GiB memory per active worker container, then load
test; this is an initial planning estimate, not a measured production capacity.
Bound total container/group memory/PIDs with cgroups. Per-job temporary disk is
approximately 100 MiB source + 90 MiB playback + 2 MiB poster + 65 MiB sandbox
scratch, with additional room for retries/orphans. Set volume quotas and alerts.
Two live leases is a global queue cap, not a substitute for OS resource controls.
Budget object requests, repeated part uploads, processing/scanning, app-proxied
video range egress and moderation staff time; no production cost/load measurements
were made here.

Deferred: resumable multipart chunks, adaptive streaming/renditions, CDN delivery,
real timed subtitle authoring, automatic transcripts, manual assistive-technology
certification, scanner/provider certification and production runtime verification.
Plain-text transcripts/descriptions and native controls do not constitute complete
captioning or WCAG certification. There are no external video embeds, messaging,
livestreams, payments, subscriptions or billing additions.
