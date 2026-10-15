# Phase 3A: private creator photo uploads

Real creator posts now support up to five JPEG, PNG or WebP photos. The existing
text/caption remains required; text-only posts continue unchanged. Photos appear
on Home, Feed, Following, creator pages and private Saved posts through the same
paginated post components. Fictional demo media and local demo interactions remain
separate. Auth, account settings, PostgreSQL, blocking, reports, appeals and staff
permissions are retained. Payments remain disabled. Nothing is deployed or merged.

## Editing and publication

Save a real draft at `/dashboard/posts`, open **Photos**, add a useful description,
and select a file. Upload progress covers transmission and processing; errors leave
a removable slot with retry guidance. Owners can remove photos, change descriptions
and move images earlier/later. Text is escaped React content, not HTML. There are
no media ownership IDs, paths, dimensions or moderation fields accepted from clients.

Every addition/reservation, removal, reorder or description change increments the
post revision and withdraws published/pending content to a private draft. Text
edits also reset photo approval. Complete ready photos are required to submit.
Rejected content can be edited and resubmitted. Removed posts require staff review;
creators cannot remove/edit their photos to bypass enforcement. Owners may withdraw
the whole post through the existing safety-preserving soft deletion path.

Staff review the full caption/title and all photos in `/admin/moderation`.
Approval checks the exact pending post revision, active/approved creator profile,
photo readiness and scan policy. Photo approval is bound to the resulting post
revision. Rejection/removal/restoration use the existing reasons, separate private
notes and audits; restoration returns the post to pending, never straight to public.
Uploads, even successfully processed ones, never approve or publish themselves.

Submission, decisions and post-report snapshots include ordered photo IDs,
descriptions, dimensions, content hashes and scan decisions. Staff can preview
retained evidence from reports/appeals after the owner removes a photo. Private
object keys, credentials and upload authorization never appear in these snapshots
or public/owner DTOs. Never-submitted draft content remains outside staff queues.

## Private storage configuration

All configuration is server-only. Do not use `NEXT_PUBLIC_` storage variables.
Builds do not instantiate a storage client and require no real cloud credentials.
Unset/invalid storage fails closed with HTTP 503 and setup guidance when an upload
is attempted; text-only functionality still works. Existing photos show an
unavailable placeholder if retrieval fails.

For local development (including a production build served on loopback):

```dotenv
MEDIA_STORAGE_DRIVER=local
BASE_URL=http://localhost:3000
MEDIA_LOCAL_ROOT=/absolute/private/path/mimi-media
MEDIA_SCAN_MODE=development-manual
PAYMENTS_ENABLED=false
```

The local adapter requires a loopback BASE_URL and an absolute root **outside the
repository**, never `public` or `.next`. It creates directories/files with 0700/0600
permissions. Keep it on a private filesystem, do not expose it through a web server,
and do not use this development mode in a public deployment. Local previews and
records explicitly say they are not content-scanned. A trusted test moderator must
still review and approve them. No browser can select this exception or change the
server environment.

For production-compatible Cloudflare R2/S3 storage:

```dotenv
MEDIA_STORAGE_DRIVER=s3
MEDIA_S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com
MEDIA_S3_REGION=auto
MEDIA_S3_BUCKET=mimi-private
MEDIA_S3_ACCESS_KEY_ID=<operator-provided server credential>
MEDIA_S3_SECRET_ACCESS_KEY=<operator-provided server credential>
MEDIA_SCANNER_URL=https://your-trusted-scanner.example/check
MEDIA_SCANNER_TOKEN=<operator-provided service credential>
PAYMENTS_ENABLED=false
```

Use a dedicated **private** bucket. Disable R2 public development URLs/custom public
domains and anonymous object access/listing; for AWS enable Block Public Access and
avoid public ACLs/policies. The adapter never sets a public ACL or returns an object
URL. Grant its server credential only required GetObject/PutObject/DeleteObject
access to this bucket; no ListBucket permission is needed. Verify bucket privacy
independently before launch. The code does not administer bucket policy or make an
existing publicly configured bucket private. Endpoint must be HTTPS; redirects
from the scanner are refused. Do not swap buckets/drivers while assets reference
the previous storage location: a storage migration is a separate operator task.

No real R2 bucket, cloud key or production data was used during development tests.
S3 compatibility uses the AWS SDK; live cloud connectivity remains an operator check.

## Security pipeline and limits

1. An authenticated active creator reserves a photo against an owned editable post
   and current revision. A random UUID, two independent 256-bit object keys and a
   256-bit one-use upload token are generated server-side. Only its SHA-256 is
   stored. Reservation expires in 15 minutes; the PUT also requires the same signed
   session, matching Origin/Host and token header. No presigned raw-upload URL or
   direct browser-to-bucket access is exposed.
2. The raw request stream is bounded at 10 MiB regardless of Content-Length/type,
   with a 30-second read deadline. Account-based PostgreSQL rate windows allow
   30 media commands/minute, 20 reservations/hour and 30 binary attempts/hour.
   Malformed/repeated attempts count. Global database processing admission permits
   two active uploads; per-owner transactional quota reservations serialize races.
3. Verify JPEG/PNG/WebP signatures and complete file boundaries; never trust MIME,
   filenames or supplied metadata. Sharp/libvips must safely decode a still image,
   at most 8,000 pixels on either side and 20 million pixels. Reject animation,
   SVG, executables, unsupported types, truncation and appended payloads.
4. Auto-orient, re-encode to WebP without retaining EXIF/GPS/ICC or other source
   metadata, resize the display image within 2,048 pixels and generate a thumbnail
   within 480 pixels. Decode/output timeouts, disabled Sharp cache, one native
   processing thread and output byte bounds limit resource use. Only these two
   sanitized variants are stored; raw originals are discarded from memory.
5. Apply the configured scanner policy to the sanitized display image/thumbnail.
   Failed scans are not stored. Unavailable scans may have private ready previews,
   but production approval is blocked. A later scanner recovery requires removing
   and reuploading that photo for a fresh scan and revision.
6. Human moderation approves the complete version. Every public feed and every
   media GET independently checks published status, matching media approval revision,
   creator approval/visibility, suspension/deletion and either direction of blocks.

A post holds at most five slots, including incomplete ones. Each account may retain
at most 200 unpurged assets and 500 MiB of reserved/stored data. A reservation counts
as 10 MiB until processing finishes; deleted-but-retained objects still consume
quota. These are initial product limits in server code, not browser hints. Limits
are enforced under database locks and persistent counters across instances.

`/api/media/[uuid]?variant=thumb|display` delivers only the two safe variants.
Anonymous/other accounts cannot read pending photos. Active owners may preview their
own nonwithdrawn posts, including hidden profiles; authorized staff may view retained
review evidence. Public delivery uses the same server predicates as the feeds and
returns 404 for unavailable/blocked content. Responses are private/no-store, vary
by Cookie, and use nosniff, same-origin resource policy and restrictive CSP. There
are no redirects to public objects, shared image-optimizer caches or CDN URLs.
Images use dimensions, responsive sources, lazy loading, async decoding, descriptive
alt text and an unavailable fallback. Already downloaded screenshots/bytes cannot
be recalled; account blocking does not prevent anonymous viewing of public content.

## Scanner contract and moderation operations

Built-in signature checks, resource limits and re-encoding are **format security**,
not malware certification, age assessment, consent verification, nudity detection,
CSAM hash matching or legal review. No such classifier is bundled or claimed.
Production photo approval requires an additional trusted HTTPS service and a human.

The configured service receives authenticated POST JSON:

```json
{
  "sha256": "sha256-of-sanitized-display-bytes",
  "contentType": "image/webp",
  "image": "base64-sanitized-display",
  "thumbnail": "base64-sanitized-thumbnail",
  "policy": "mimi-non-explicit-v1"
}
```

Its successful JSON response must be no more than 8 KiB and contain the same
`sha256` and `policy`, plus `"malware":"pass"` and `"content":"pass"`. Every
other/missing decision blocks approval; network/HTTP/parse/timeout errors are
unavailable, never safe. The digest binds the verdict to the reviewed display
bytes. Select a provider that actually implements both assessments and covers both
variants, document its accuracy/limitations, data processing/retention, access and
incident handling, and test it before connecting a public deployment. Do not use a
service that simply echoes pass values. No photo is automatically published after
receiving this response.

Provision trusted staff through the existing Phase 2B operator process, independently
of SaaS roles. Review explicit/exploitative content, privacy and consent, including
background IDs/addresses and other people's likenesses. Photos involving minors
must never be sexualized and need appropriate guardian/subject consent. Establish
age/eligibility policy before public launch; this phase does not verify age or
consent. Quarantine/escalate suspected exploitation through authorized procedures,
avoid downloading/redistributing it, and follow applicable reporting/preservation
obligations with qualified operational guidance. Configure suitable specialist
scanning/reporting services where required. Operators still need staff training,
MFA/access controls, response coverage and a documented appeals process.

## Additive migration and cleanup

`0005_puzzling_shaman.sql` creates only `media_assets`, its indexes, foreign keys
and checks. It records ownership/post, ordered descriptions, upload/processing and
moderation state, approved revision, scan status/policy, private object references,
quota bytes, dimensions/hash, expiry and retention timestamps. No existing table,
account record, constraint or production data is removed or rewritten.

Run the trusted operator job (dry run by default):

```bash
pnpm media:cleanup --dry-run
pnpm media:cleanup --apply
```

Schedule `--apply` every five minutes in an environment with the same private
storage/database configuration; the application does not schedule it automatically.
Each run handles at most 50 candidates. Repeat while `morePossible` is true.
SKIP LOCKED and idempotent object deletion allow retries/concurrent workers. A
failure retains records/quota for retry. Purged metadata/audit records remain.

Expired reserved/processing uploads are eligible after the 15-minute deadline;
failed uploads after one hour; removed photos, withdrawn posts and soft-deleted
accounts after 30 days. The latter grace period preserves review evidence; GET
access is revoked immediately. Ready photos in intentional drafts are not treated
as abandoned. No raw unregistered staging objects exist: both keys are recorded
before writes, so crashes after partial storage can be cleaned. In-flight processing
rechecks state/expiry under an asset lock before any object write. Cleanup skips
locked uploads; a crash rolls processing state back so known keys remain eligible
for cleanup. Changed post/lease state prevents late writes. Purged
slots remain visible to owners for removal and cannot bypass submission checks.

These are development retention defaults, not a legal-hold system. Establish
preservation/retention/deletion policy and implement any required hold workflow
before enabling production cleanup. Audit snapshots retain textual evidence and
hashes after object removal; binary evidence is unavailable once purged. If bucket
versioning is enabled, configure noncurrent-version retention too: deleting a key
alone does not erase retained object versions. Monitor failed purges/storage usage,
backups and bucket access; do not set a bucket TTL that deletes approved assets.

## Development verification

Use Node 24, pnpm 9.15.9, the existing development database/auth secret, and the
local environment settings above. There are no Stripe keys or cloud credentials.

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm typecheck
PAYMENTS_ENABLED=false NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm build
PAYMENTS_ENABLED=false pnpm start --port 3010
```

In a second terminal with the **same** local storage variables:

```bash
TEST_BASE_URL=http://127.0.0.1:3010 \
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs
```

Integration tests refuse non-loopback app/database destinations; media tests also
require the private local adapter. They create independent disposable accounts and
manually provisioned test staff, generate benign image fixtures, and delete only
their own records/objects. Cleanup assertions scope the job to the fixture owner.
Scanner response-contract tests use an isolated HTTP stub; they do not certify a
real scanning service. `pnpm test` without integration settings skips those cases
and does not establish full validation. The system-CA build flag preserves TLS
verification for Google Fonts in this cloud environment.

## Recorded validation

- Production build and standalone TypeScript checks passed without storage or
  Stripe credentials. Google Fonts used the trusted system certificate store.
- The additive development migration and an idempotent repeat passed.
- **72 automated tests passed, zero failures/skips**, including the complete
  prior suite. Media coverage includes JPEG/PNG/WebP, EXIF removal/orientation,
  SVG/executable/truncated/appended/animated/dimension/byte rejection, strict
  ownership/CSRF/revisions, one-use/expired authorization, five-photo and
  200-asset/500-MiB quotas, rates, scan-contract failures, publication and reapproval,
  both block directions, visibility/suspension/deletion, reports/appeals, cleanup,
  and expiry racing an in-flight upload. The cleanup CLI dry run also passed.
- Multi-account Chromium photo checks passed private uploads/progress, ordering,
  error recovery, owner/staff preview and larger-image access, review/approval,
  all five gallery surfaces, saved collections in a separate browser context,
  withdrawal/reapproval, reporting and blocking. An unconfigured second server
  returned the expected setup HTTP 503 without changing the post.
- Existing text-only social, registration/login/logout, account/password settings,
  creator profiles/discovery/visibility, moderation, demo interactions and mobile
  navigation browser regressions passed.
- **44 clean axe WCAG A/AA desktop/mobile states**: photos (11), existing social
  (11), creators (10), existing moderation (12). No browser errors or horizontal
  overflow. The expanded content-evidence panel is keyboard-focusable.

All database/storage fixtures were local and disposable; temporary accounts,
permissions and objects were removed afterward. No production storage/data, live
classifier, real payments, merge or deployment was used. Live R2 connectivity,
scanner quality and production load remain unverified operator responsibilities.

## Limitations and future media work

Uploads currently pass through the Next.js server and require a host/reverse proxy
that accepts at least 10 MiB and up to 120-second route duration. Some serverless
platforms have lower body/time limits; verify hosting before deployment or design
a separate quarantined upload worker. CPU/memory and proxy limits, request/body
abuse protection, cross-account/IP anti-abuse, backpressure and production load
benchmarks remain operator work. The global processing admission limit defaults
to two; expensive multi-account attacks need additional infrastructure controls.

No live R2 or external classifier certification was performed here. No real-time
rescan, bulk importer, storage migration, physical legal-hold UI, crop editor,
original download, video, external embeds, messaging, notifications or payment
processing is included. Videos need separate quarantined storage, duration/codec
and resource limits, isolated transcoding, audio/frame scanning, generated posters,
streaming delivery, consent/privacy review, and larger asynchronous job/retention
infrastructure. Do not enable videos by broadening this photo allowlist.
