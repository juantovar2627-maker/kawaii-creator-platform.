# Mimi: Phase 1

Mimi is a temporary brand, centralized in `lib/brand.ts`. This phase retains
the payments-disabled foundation. There are no database migrations,
Supabase changes, enabled payments, or deployments in this phase.

## Pages

Visual review: [desktop homepage](screenshots/home-desktop.jpg) ·
[phone homepage](screenshots/home-mobile.jpg).

| Route                                                              | Purpose                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/`                                                                | Illustrated landing page, featured creators, categories, feed preview                        |
| `/discover`                                                        | Searchable, sortable creator directory with category filters                                 |
| `/creators/[username]`                                             | Six fictional creator profiles, public demo posts, follow and unavailable membership preview |
| `/feed`                                                            | Photo/video feed with local likes, comments, saves, sharing and moderation menus             |
| `/following`                                                       | Browser-local followed creators and their demo posts                                         |
| `/notifications`                                                   | Clearly labeled sample notifications with local read state                                   |
| `/profile`                                                         | Private overview of the authenticated account, not a public creator identity                 |
| `/settings`                                                        | Redirect to authenticated profile settings                                                   |
| `/dashboard`                                                       | Personal account overview and demo activity summary                                          |
| `/dashboard/general`, `/dashboard/security`, `/dashboard/activity` | Existing real account settings, password/account management, and audit log                   |
| `/dashboard/saved`                                                 | Browser-local bookmarked demo posts                                                          |
| `/dashboard/creator-tools`                                         | Local text drafts; uploads and publishing unavailable                                        |
| `/dashboard/team`                                                  | Preserved workspace/team management from the starter                                         |
| `/community-guidelines`                                            | Community expectations and moderation limitations                                            |
| `/sign-in`, `/sign-up`                                             | Redesigned forms using the original authentication actions                                   |

## Data boundaries

- Real accounts, password hashes, sessions, teams and audit logs stay in Postgres.
  Account responses and SWR hydration omit password hashes from browser data.
- `lib/demo/community.ts` contains fictional creators and editorial posts. These
  string IDs are not database user IDs. Follower statistics and seeded comments
  are examples, not live activity.
- `mimi-community-demo-v1` stores demo follows, likes, saves, comments, blocks,
  report drafts and notification read state in localStorage. These actions are
  device-local and are not tied to a real account. Reset them from My Space.
- `mimi-creator-draft-v1` stores one local text draft. It is never uploaded,
  published, sent to another person or inserted into the database.
- Original generated illustrations are in `public/images`. The playable video
  is an original silent four-second color-study animation with descriptive
  captions. All visual creator identities are fictional illustrations.
- Social profile links are explicitly labeled demo links and open the external
  platform homepage. Sharing copies the local demo creator URL.

## Payments

Keep `PAYMENTS_ENABLED=false`, with both Stripe variables absent. The existing
lazy SDK initialization and server guards remain in place. Membership previews
cannot be purchased. The original unavailable pricing page and payment
regression tests are retained.

## Validation

Use the prepared Node 24 / pnpm 9 toolchain:

```bash
PAYMENTS_ENABLED=false NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm build
pnpm exec tsc --noEmit
node --test tests/community-data.test.mjs tests/payments-config.test.mjs
# Start the current production build, then exercise its payment boundaries:
PAYMENTS_ENABLED=false pnpm start --hostname 127.0.0.1 --port 3002
TEST_BASE_URL=http://127.0.0.1:3002 node --test tests/payments-disabled.test.mjs
```

Browser checks should cover search/category/empty results, follow persistence,
Following, post likes/comments/saves, saved posts after authentication, video
playback, report-dialog keyboard focus and its local-only confirmation, blocking
and unblocking, draft persistence, notification read state, account/profile
updates and password changes. Check phone and desktop widths, keyboard focus,
404 handling, and all navigation destinations.

Verified for this branch: production build and standalone TypeScript checks;
11 Node tests (none skipped); the browser flows above at desktop and phone
widths; existing Postgres migrations without schema changes; and automated
WCAG A/AA scans across seven public screens, six authenticated account screens,
and the open reporting dialog. The final clean-start run reported no browser
errors or accessibility violations. Temporary verification accounts and teams
were removed after testing. One earlier iterative run logged a transient
minified client initialization error that did not recur in subsequent clean-start
runs; the existing Next.js canary remains pinned.

## Backend work for later

Public creator identities and biographies, profile uploads, media ingestion,
publishing, account-scoped social graphs and bookmarks, comments/likes APIs,
real notification delivery, server-side moderation and appeals are not
implemented. The frontend does not claim these are live. See
`moderation-foundation.md` before building reporting or enforcement.

The optional-Stripe foundation was merged into `main` before this feature branch
was finalized. Review this phase against `main`.
