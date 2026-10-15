# Phase 2A: real creator profiles

Mimi now stores opt-in creator profiles in PostgreSQL while retaining the six
fictional creators and all existing authentication/account functionality.
Stripe remains disabled by default; no payment credentials, media uploads,
public posts, or messaging are introduced.

## Working routes and interactions

- `/dashboard/creator-space` — **My Creator Space**, authenticated setup/editing:
  username, display name, biography, four pastel themes, four avatar presets,
  three banner presets, one to three categories, optional website/Instagram/
  YouTube links, visibility, and saved-profile timestamps.
- `/dashboard/creator-space/preview` — authenticated preview of the owner's saved
  profile, including hidden profiles. It never accepts another account's ID.
- `/profile` and `/dashboard` — retain private account information and link to
  My Creator Space. Existing account name/email/password/team settings remain.
- `/creators/[username]` — request-time resolution of real and fictional creators;
  case-insensitive real usernames; actual HTTP 404 for unknown, hidden,
  suspended, or deleted-account profiles. Username changes replace the old URL.
- `/discover` — separate community and fictional sections with search/category
  filters and name sorting. Only approved, explicitly listed real profiles appear.
  The initial directory includes up to 100 approved profiles; pagination is deferred.
- `/api/creator-profile` — authenticated GET of the owner's profile, POST to create,
  PATCH to replace editable profile fields. Responses are private and uncached.
  The client cannot choose the owner or set moderation state.

## Visibility and moderation boundary

Profile creation is optional; registration never creates a public profile.
The default is **unlisted**, meaning anonymous visitors with the URL can view it,
but it is absent from Discover. Unlisted is not a secrecy guarantee. Creator pages
send `noindex, nofollow` metadata; this is a crawler hint, not access control.

**Hidden / deactivated** profiles return 404 even to the owner at the public URL.
The owner can still edit, preview, and reactivate their profile.

Creators may request discovery listing. A request remains unlisted until
`moderation_status` is approved through a future restricted review process.
There is deliberately no public approval endpoint or automatic approval. Every
profile edit resets approval to pending; suspended profiles remain suspended.
Tests simulate approval only on disposable development fixtures. Do not approve
real profiles until the moderation workflow and operating safeguards exist.

Profile text is rendered as escaped React text, with no HTML/Markdown rendering.
Links must be public HTTPS URLs without credentials, custom ports, literal IPs,
or local hostnames. Instagram and YouTube links use platform host allowlists.
Links are clearly external, unverified, and use `nofollow ugc noopener noreferrer`.
No remote fetching or embedding occurs. Presets cannot inject CSS or image URLs.

Mutations require a verified session, an active database account, and matching
Origin/Host. Inputs reject unknown fields and bodies over 8 KB; usernames are
normalized and reserved names include all six demo usernames. PostgreSQL enforces
one profile per user and a unique lowercased username index, including races.
A PostgreSQL upsert enforces 20 attempts per account per minute across instances;
invalid inputs count toward the limit. Public queries explicitly project only
creator fields, excluding account IDs, emails, passwords, sessions, roles, payment
fields, and internal moderation state. Soft-deleted owners are excluded.

## Additive migration

`lib/db/migrations/0001_flowery_skullbuster.sql` creates `creator_profiles` and
`creator_mutation_limits`, their foreign keys, checks, and a unique username
index. It does not alter, drop, or rewrite existing tables or account data.
The accompanying Drizzle snapshot/journal support subsequent migrations.

Point `.env` at your **development** PostgreSQL instance, then run:

```bash
pnpm db:migrate
pnpm typecheck
pnpm build
```

In this cloud environment, use the existing pnpm 9.15.9 tool path and
`NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` for Google Fonts through the
trusted system certificate store. TLS verification remains enabled. No seed or
Stripe credentials are needed.

Partial prerendering uses `ppr: 'incremental'` with the root layout opted in,
preserving existing pages. Creator routes opt out so visibility/404 decisions
happen before streaming; a globally forced PPR shell would return HTTP 200 for
unknown or hidden usernames.

## Automated verification

Use Node 24 (the cloud toolchain). Start the production server with payments off,
then run the full suite with explicit local test settings:

```bash
PAYMENTS_ENABLED=false pnpm start --port 3006
# In another terminal; AUTH_SECRET is loaded from the same local .env as Next.
TEST_BASE_URL=http://127.0.0.1:3006 \
TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54322/postgres' \
node --env-file=.env --test tests/*.test.mjs
```

Substitute your local development database URL. The integration suite refuses
non-loopback server/database hosts, creates two random disposable accounts,
signs their independent sessions, and removes only its fixtures in `finally`.
Never point it at production. The URL and AUTH_SECRET must match the running app.
`pnpm test` without these settings runs pure tests and explicitly skips the HTTP/
database cases; that alone is not full validation.

The suite covers creation, ownership, normalized/reserved/duplicate usernames,
database uniqueness, updates and timestamps, safe rendering/links, rejection of
privileged fields and oversized bodies, approval gating and revocation,
hidden/suspended/deleted profiles, direct URLs and real HTTP statuses, owner
preview, concurrent rate limiting, all six demo routes, and disabled checkout,
webhook, pricing, and payment server actions.

## Deferred to Phase 2B

- Staff moderation permissions, review queue, audit log, notices and appeals.
- Real reporting/blocking, anti-spam controls across registration/accounts,
  moderation of public profile text/links, and safe operational review procedures.
- Real follow relationships, follower counts, posts, comments, messages and uploads.
- Discovery pagination and backend filtering as the community grows.
- Profile history, username-change redirects, and account/profile deletion policy.

Demo reports/blocks remain browser-local and do not act on real accounts.
Membership and follow controls on real profiles clearly show their unavailable
state. There is no new path to process payments. Nothing is merged or deployed
as part of this phase.

## Validation recorded for this branch

- Production build and standalone TypeScript checks passed with payments disabled
  and no Stripe credentials.
- The additive development migration and an idempotent repeat both passed.
- All **23 automated tests passed**, with zero skipped tests, against the local
  production server and PostgreSQL. This includes simultaneous username claims
  by two accounts and concurrent excess mutation attempts.
- Browser checks with two independent registered accounts passed profile creation,
  duplicate prevention, editing, preset persistence, public access, discovery
  search/filtering, moderation gating, hiding, and owner preview.
- Ten new desktop/mobile states had zero WCAG A/AA violations in axe-core scans;
  creator pages fit a 390px viewport without horizontal overflow or client errors.
- Existing browser regressions passed registration/login/logout, account settings,
  password changes, team/activity screens, demo search/follow/save/comment/report/
  block flows, local post drafts, video playback, and mobile navigation.

Next emits existing canary/middleware and stale browser-baseline warnings; these
are not compilation failures. No dependency upgrades are included in this phase.
