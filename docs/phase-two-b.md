# Phase 2B: community safety and moderation

Mimi now has database-backed profile moderation, reporting, blocking, and requests
for another review. Existing authentication, PostgreSQL accounts/settings, creator
presets, public routes, six fictional creators, and disabled-payment guards remain.
No deployment, production migration, uploads, posts, or messaging is included.

## Routes and interfaces

- `/admin/moderation`: restricted staff dashboard with pending creator approvals,
  report and review-request counts, creator search, status filters, profile review,
  approve/reject/suspend/restore controls, and decision/audit history. Queue and
  individual profile history pages contain at most 20 records, with next/previous
  controls. Profile reviews move keyboard focus to the review heading.
- `/dashboard/safety`: authenticated **Community Safety** account page showing only
  that member's blocks, reports and moderator responses, creator decisions, and
  review requests. Each history section is paginated at 20 records per page.
- Real `/creators/[username]` pages: authenticated reporting/blocking controls, with
  confirmation only after the server commits. Anonymous visitors see a sign-in
  link. Public previews and fictional profiles do not submit real reports.
- **My Creator Space**: shows pending/approved/rejected/suspended status, the
  creator-facing reason, and a link to decision history and review requests.
- `/api/admin/moderation`: authorized GET queues/profile details and POST decisions.
- `/api/safety`: authenticated GET of the member's own records and POST report,
  block, unblock, or review-request actions. No caller-supplied owner ID is accepted.

The six demo creators, browser-local reports/blocks, and demo reset remain
independent. No localStorage reports are imported. Real moderation never changes
demo content, and resetting demo state does not clear real safety records.

## Separate staff permissions and first administrator

`platform_staff` is the sole platform permission source. Both `admin` and
`moderator` may perform moderation; permission grants/revocations are **manual
operator operations only**, for either role. Existing `users.role`, SaaS team
ownership/membership, session role claims, creator settings, query parameters, and
client state grant no platform authority. Registration creates no staff entry.

Every admin page/API checks the active database permission and account. Pages and
APIs return 403 without revealing moderation data to unauthorized visitors. APIs
repeat authorization independently of page/middleware checks. Mutations recheck
and lock the staff record within their transaction, so revocation takes effect
with an existing session. Staff cannot review their own profile, their own review
request, reports they submitted, or reports targeting their own profile.

To provision the first administrator:

1. Have the intended staff member register normally. Verify their identity and
   account ownership through your trusted operator process.
2. In a trusted database console, find the active account's numeric `users.id`.
   Do not expose database credentials, account emails, or authentication secrets
   through the frontend, a public admin-creation route, or chat.
3. Apply the additive migrations to your development database. Set `POSTGRES_URL`
   in the trusted operator environment (the local ignored `.env` works in this
   cloud environment), then run the checked-in script. Replace `123` below with
   the verified ID; the operator label is an audit label, not a password:

```bash
node --env-file=.env scripts/platform-staff.mjs \
  --action grant --user-id 123 --role admin \
  --operator 'trusted-operator' \
  --reason 'Provision the verified first Mimi administrator.'
```

Provision a moderator with `--role moderator`. Revoke access with `--action revoke`
and the account ID/role. All permission changes run in a transaction under an
operator advisory lock and append an audit event with previous permissions,
operator label, and reason. The tool refuses to remove/demote the last active
administrator. It creates no users or credentials and never prints credentials.
Do not run example provisioning against production as part of this development task.

Use separate trusted operator credentials for provisioning in a deployed system.
The application database role should have read access, **no write access** to
`platform_staff`, and no UPDATE/DELETE access to `moderation_audit`. The starter's
local development connection is a trusted database owner; deployment-specific
role grants and operational backup/retention controls are not configured by this
phase. There is no application route that changes staff permissions or audit rows.
Existing account soft deletion disables authentication/staff access and preserves
history; an operator can provision another verified account if staff delete theirs.

## Creator decisions and visibility

New profiles remain opt-in and **unlisted by default**. Unlisted means public by
link, not private. Hidden/deactivated profiles return actual HTTP 404, including
the owner's public URL; only the authenticated owner preview bypasses hiding.

- Listing requires owner `visibility=listed` plus staff approval. Unlisted/hidden
  profiles cannot be approved accidentally, and approval never changes visibility.
- Rejection leaves the direct public link available but excludes Discover. Creators
  receive a clear reason and may edit and resubmit. Each edit resets approval or
  rejection to pending; decisions remain in history.
- Suspension makes the profile unavailable publicly and in discovery. Editing,
  renaming, hiding/reactivating, or submitting a review request cannot remove it.
  One-profile-per-account uniqueness prevents a second profile as a bypass.
- Restoration returns the profile to pending review, preserving its owner-chosen
  visibility. It does not restore Discover approval automatically.
- Staff decisions require the reviewed profile revision. A concurrent edit or
  another decision makes stale commands fail with 409. Profile state, decision
  snapshot, reason, private staff note, and audit event commit atomically.

To preserve the existing database CHECK constraint without destructive constraint
replacement, rejection is stored as an additive `listing_rejected` flag alongside
legacy `moderation_status=pending`. Owner/staff interfaces expose it as rejected;
public discovery excludes it. `moderation_reason` is creator-visible; internal
notes are separate and never included in public or owner responses. Staff are
explicitly instructed not to copy reporter identities into creator-facing reasons.
Public profile queries still project only public creator fields.

## Reports, evidence, and review requests

Authenticated members may report a real public creator for harassment/bullying,
spam, impersonation, privacy violations, non-consensual content, explicit material,
or moderation evasion. Self-reports are rejected. Hidden, suspended, nonexistent,
and fictional targets cannot be enumerated through report submission.

Reports store the target profile, reporter, reason, optional bounded explanation,
timestamp, review status, and a snapshot of public profile fields at submission.
The snapshot remains available to staff if the creator later edits their profile.
Report explanations and reporter identity are never public; ordinary members
can read only their own submissions. Staff queues omit reporter account details.

A partial unique index permits one open report per reporter/profile; repeated
submissions return 409. Reports are reviewed as resolved or dismissed, with a
reporter-facing response and optional private staff note. Resolution and its audit
record are atomic; concurrent/repeated resolutions cannot overwrite one another.
A report never automatically suspends someone. Profile enforcement is an explicit
staff decision against the reviewed profile revision.

A creator may submit one review request per rejection/suspension decision, with
an explanation. The server verifies ownership of that decision. Staff responses
and audit history persist, and the creator can read the outcome on Community
Safety. Marking a request reviewed does not silently override newer enforcement;
staff must separately approve or restore the current profile if the decision
should change. This is a basic review-request workflow, not an automated appeals
court or a guarantee of a different reviewer.

## Account blocking

Blocks persist in PostgreSQL by account ID, so renaming does not bypass them.
Self-blocks and duplicate relationships are rejected. Only the blocker can list
or remove their blocks. The private block list keeps the public name/username
snapshot from when the block was created; unblocking uses the owned block record,
so it still works if the target is hidden, suspended, or renamed.

Either direction of a block excludes the other account from signed-in Discover
and creator-page queries (404). Anonymous public access is unaffected. Staff
review queries intentionally bypass personal block filters. There are no real
feeds, messages, or notifications to filter yet; those future surfaces must use
server-side block filtering when implemented. No promise of anonymous secrecy is
made, and reverse block relationships are not exposed through an API.

## Security, persistence, and limits

- Existing verified session authentication and active-user checks protect member
  mutations; server-side ownership protects all member records.
- Cookie-authenticated JSON writes require matching HTTP Origin/Host, strict Zod
  inputs, positive identifiers, bounded text, and an 8 KB streamed body limit.
  Extra fields, including owner IDs and roles, are rejected. User text is escaped
  React text; there is no HTML/Markdown execution or embedded external content.
- PostgreSQL rate windows are shared across instances: 30 safety attempts/minute,
  5 reports/hour, 3 review requests/hour, 60 staff decisions/minute, in addition to
  existing profile limits. Malformed inputs count; duplicate reports consume the
  reporting limit. Excess requests return 429 with a conservative Retry-After.
- Foreign keys, uniqueness checks, transactions, row locks and profile revisions
  protect ownership and consistency. Audit records are append-only in application
  code; there are no audit-edit/delete endpoints. Soft account deletion retains
  related records. A trusted database owner remains able to administer its data.
- Queue inputs and pagination are bounded. Reasons visible to creators/reporters
  are projected separately from internal notes, snapshots and staff-only history.

Migrations `0002_robust_scorpion.sql` and `0003_brainy_ricochet.sql` only add six
safety tables, profile revision/rejection/reason fields, report snapshots, indexes,
checks and foreign keys. No existing tables, data, or constraints are removed.

## Development verification

Use the existing development `.env`, Node 24 and pnpm 9.15.9 in this cloud workspace:

```bash
pnpm db:migrate
pnpm typecheck
PAYMENTS_ENABLED=false NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm build
PAYMENTS_ENABLED=false pnpm start --port 3006
```

In another terminal, run all tests against that same local database and auth key:

```bash
TEST_BASE_URL=http://127.0.0.1:3006 \
TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54322/postgres' \
node --env-file=.env --test tests/*.test.mjs
```

Use your own loopback development URL as appropriate. Integration tests refuse
non-loopback server/database destinations. They create independent disposable
member/staff accounts and provision test staff through the manual operator script.
Fixture-only cleanup removes their safety records, permissions and audit events;
application users and staff have no such deletion API. No production data or real
staff account is changed by testing. Without integration settings, `pnpm test`
explicitly skips HTTP/database cases and does not establish full readiness.

## Operating limitations and next work

This backend supplies tools, not automatic moderation or continuous staffing.
A trusted operator still needs to provision real staff and establish response
coverage, review standards, escalation, retention/deletion policies, backups,
least-privilege database grants, and staff account security before launch. Staff
use the existing password/session authentication; MFA/SSO is not introduced here.
Reasons are human-written, so reviewers must avoid disclosing reporter details.
Rate limits are per account; registration/IP anti-abuse, ban-evasion detection
across new accounts and automated content classification remain future work.

Discovery still uses the Phase 2A maximum of 100 reviewed creator entries;
moderation/history queues have real pagination. Blocking is account-based, not a
network/IP ban. No external notification delivery, real social posts/follows,
media uploads, direct messaging, payments or billing is added. Stripe credentials
remain optional and absent in the tested environment.

## Verification recorded for this branch

- Production build and standalone TypeScript checks passed without Stripe keys.
- Both additive migrations applied to development PostgreSQL; a repeat migration
  run passed without changing existing data.
- All **39 automated tests passed, zero skipped**, including the existing profile,
  demo and payment regressions and new multi-account moderation/permission tests.
- Browser checks with independent creator, member, anonymous visitor and manually
  provisioned moderator contexts passed rejection, review requests, approval,
  discovery, reporting, persistent blocking, resolution, suspension and restoration.
- Twelve moderation/safety desktop/mobile states and ten existing creator states
  had zero WCAG A/AA violations in axe-core scans, with no browser errors or
  horizontal overflow at a 390px mobile viewport.

- The isolated existing frontend/authentication browser regression also passed:
  registration/login/logout, profile/password changes, team/activity settings,
  demo search/follow/save/comment/report/block/video/drafts, and mobile navigation.

Existing Next canary/middleware deprecation and stale browser-baseline warnings
remain informational. No dependency upgrades are included.
