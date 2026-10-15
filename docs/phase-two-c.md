# Phase 2C: real text-only social features

Mimi now stores real follows, creator text posts, likes, comments, saved posts,
content reports, and content review requests in PostgreSQL. Phase 2B profile
moderation, account blocking, authentication/account settings, the six fictional
creators, and disabled-payment configuration remain in place. No media uploads,
embeds, subscriptions, payments, direct messages, merge, or deployment are included.

## Real and demo interfaces

- `/feed`: real approved text posts, followed by a labeled fictional demo feed.
- `/following`: real followed creators and their approved posts, followed by the
  existing browser-local demo following experience. Real follows require sign-in.
- `/creators/[username]`: real follower count/follow control and approved creator
  text posts; fictional creator routes retain their original demo posts/controls.
- `/`: up to three recent real text posts plus the original illustrated demo area.
- `/dashboard/saved`: private real saved-post collection and separately labeled
  browser-local demo bookmarks. Real saves persist across sessions/devices.
- `/dashboard/posts`: **Text posts**, the authenticated real creator workspace.
  Drafts, pending submissions, rejected/removed reasons, and approved posts are
  paginated here. The old local-only creator studio stays at `/dashboard/creator-tools`
  and links to this real workspace. No local drafts are imported into PostgreSQL.
- `/dashboard/safety`: the existing account safety page plus **Social Activity &
  review requests** for the member's own comments, content reports, decisions,
  and post/comment review requests.
- `/admin/moderation`: the existing profile dashboard plus **Post & comment
  moderation** queues for text posts, comments, content reports and review requests.

All implemented routes retain Mimi's pastel styling, rounded cards and responsive
layouts. Interaction feedback is based on server confirmation. Counts and action
state revalidate from PostgreSQL; there are no optimistic fabricated counts.

## Post lifecycle and visibility

Creator posts have an optional title (120 characters) and required plain-text body
(4,000 characters). There is no HTML/Markdown rendering, link auto-embedding, or
media attachment. All rendered text uses normal escaped React children.

| State     | Visibility and allowed transitions                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| draft     | Owner only; edit, withdraw, or submit for review.                                                                   |
| pending   | Owner and authorized staff only; approve/reject; owner edit returns to draft.                                       |
| published | Public only while the creator remains eligible; edit immediately withdraws to draft.                                |
| rejected  | Owner and staff; creator may edit/resubmit, or request review of the decision.                                      |
| removed   | Not public; owner edits/resubmission are blocked; request review or withdraw. Staff restoration returns to pending. |

Staff approval is accepted only for the reviewed pending revision, after the
creator profile is approved, active, and not hidden. Content decisions atomically
update status/revision and append an audit snapshot, author-facing reason and
separate private staff note. Owner edits never set approval and increment the
revision, so stale staff approvals cannot publish a new version. Owner withdrawal
soft-deletes the post and preserves history. Never-submitted draft text is not
included in staff queues or withdrawal audit snapshots.

Every public post read requires: published and not withdrawn; active, nondeleted
creator account; approved profile without rejection; nonhidden profile; and no
block in either direction with the viewer. Removing creator approval (including
profile edits), suspension, hiding, or account soft deletion pauses all that
creator's public posts without deleting them. A fresh profile approval may make
previously approved post versions available again.

Main/home feeds additionally require listed visibility. An approved unlisted
profile's posts can be read by direct creator/post access and known followers or
saved collections; unlisted is not a secrecy guarantee. The current profile
workflow normally resets approval when changing visibility, as documented in
Phase 2B. Pending, rejected, removed, and draft posts never appear in public APIs.

The feed orders by publication time descending, then ID descending. Reapproval
sets a new publication time. Feeds use bounded database pages of ten records
(three for home previews), with loading/empty states and previous/next controls.
Pagination is offset-based with page bounds, not an unlimited in-memory feed.

## Follows, likes, and saves

Follows use a unique follower/creator-account pair and prohibit self-following.
Targets must be active, public (including direct-link unlisted profiles), and
nonsuspended. Accounts under creator suspension cannot start social interactions.
Counts include eligible active followers, excluding deleted/suspended members and
blocked account pairs. Duplicate requests express the desired follow state and
are idempotent. Unfollow remains possible when a previously followed target is
no longer public, so the owner can remove the relationship.

Likes and saves use unique account/post pairs. Like/unlike and save/unsave are
idempotent and authenticated. Like counts are computed in indexed database
subqueries; there is no per-post unbounded fetch of liker accounts. No public
liker list or saved-by identity is exposed. Saved collections always use the
session account, never an input owner ID, and reapply public post eligibility on
every read. Removed, hidden, pending or blocked content cannot be recovered from
a saved collection. Unlike/unsave can clean up an existing relationship even
when the target is unavailable. Reactions/bookmarks remain attached to a post ID
across reviewed revisions; a newly approved revision can reappear in collections.

## Comments and account identity

Authenticated nonsuspended members may comment on eligible public posts. Comments
are plain text, limited to 600 characters, visible immediately without a preapproval
queue. They can be reported and removed by staff. Authors may edit/delete only
their own visible comments; edits require the current revision. Moderation removal
cannot be undone by an author edit. Deletion is a soft withdrawal retaining
moderation/report history. Authors can remove their own comments from Social
Activity even if the parent post is no longer available.

A comment shows the author's public creator identity only if that profile is
visible. Otherwise it displays **Mimi member**. Private account names, emails,
passwords, session information, and account IDs never become comment identity.
Hiding a creator profile does not delete the member's comments: their public
identity becomes generic. Deleted/suspended author comments are excluded from
public queries. Comment lists and counts filter blocks in either direction with
the viewer and require an eligible public parent post, including on every page.
Lists have ten comments per page, newest first. The creator may read permitted
comments on their posts through the same interface. There are no threaded replies
or notification delivery in this phase.

## Blocking across social surfaces

Phase 2B account blocks now gate feeds, creator following, real follows, comment
lists, interactions, and private saves in addition to profile/discovery queries.
Creating a block removes real follows in both directions atomically; unblocking
does not silently recreate follows. Advisory locks on the two account IDs serialize
follow/interaction writes with new blocks. Eligibility reads lock relevant account,
profile and post rows against concurrent hiding, deletion and moderation changes.

A member can also block a **comment author**, including a member without a creator
profile. The server resolves the account from an accessible comment ID; it never
accepts a target account ID from the client. Generic members are stored as
“Mimi member”/`mimi_member` in the blocker's private block list instead of exposing
private identity. The existing owned-block removal control unblocks them.

Blocking does not erase historical comments or prevent anonymous access to public
information. Staff review deliberately bypasses personal block filters. Demo blocks
continue to affect demo content only. Resetting demo state does not clear real
follows, likes, saves, comments or safety records.

## Content reports and enforcement reviews

Reports target an accessible real published post or visible comment. The server
validates target eligibility, rejects self-reports, and saves a snapshot of the
reported public text/revision. One open report per reporter/target is enforced by
partial unique indexes. Report details and submitter identities are private;
ordinary accounts see only their own submissions. Staff queues omit reporter
account details and expose evidence snapshots for review after content edits.

Authorized staff may approve/reject pending posts, remove violating posts/comments,
and resolve reports with a submitting-member response. Resolving a report alone
does not remove content. Authors receive separately labeled enforcement reasons;
private notes never appear in public/owner API projections. Staff cannot review
their own content, their own appeals, reports they submitted or reports targeting
their own content. Every enforcement/permission change retains audit history.

Post rejections/removals and comment removals can receive one owner-scoped review
request per decision. This works for commenters without creator profiles too.
Staff can respond without automatically overriding newer enforcement. Explicit
post restoration returns to pending, followed by a separate approval; comment
restoration requires an eligible parent post/author and no blocked author/creator
relationship. Decisions and review responses persist across sessions.

## Security and API boundaries

`/api/social` uses authenticated POST commands with strict Zod schemas, ownership
from the verified session, CSRF Origin/Host checks, and the existing 8 KB streamed
body cap (including JSON overhead; multibyte text can reach that cap earlier).
Inputs cannot select ownership IDs or moderation state. Resource IDs and revisions
are validated positive integers. Public GET projections include only public text,
creator identity, counts, and that viewer's action state; owner APIs separately
return drafts/decisions. Every response is private/no-store to prevent sharing
viewer-specific cache data. Sensitive GET collections require sign-in.

The root layout resolves account/team data before supplying SWR fallbacks. This
avoids a reproduced SWR 2.3.x/React 19 promise-subscription initialization error
when many social components share the account key. Layout pages now render per
request instead of partially prerendering their session-dependent shell; no
authentication credentials or dependency versions change. The client cache provider
is also keyed by the verified server account, so signing out/in remounts state
and creates a fresh cache for private drafts, saved collections and history.

`/api/admin/social` checks live Phase 2B `platform_staff` permissions independently
of the page and locks staff permission inside each mutation transaction. Existing
profile moderation APIs and the manual staff provisioning process are unchanged.
Staff content queues are paginated at ten records; draft bodies are not queued.
All text remains escaped, including report evidence and audit snapshots.

Database-backed rate windows apply across instances: 40 social attempts/minute,
10 new drafts/hour, 10 comment creates/edits per five minutes, 5 content reports/hour,
and 3 content review requests/hour. Staff content/profile decisions share the
existing 60/minute moderation limit. Malformed attempts consume the general limit;
duplicates consume action-specific limits. Suspended accounts cannot publish or
create social reactions/comments/follows, but may withdraw, report, block and
request reviews through safety tools.

## Migration and development checks

`0004_early_arclight.sql` only adds seven social tables, foreign keys, checks and
indexes: `creator_follows`, `social_posts`, `social_comments`, `post_likes`,
`saved_posts`, `social_reports`, and `social_appeals`. Existing users, profiles,
authentication, staff permissions and records are preserved. No destructive SQL or
production fixture cleanup is part of this task.

Use the existing local development `.env`, Node 24 and pnpm 9.15.9:

```bash
pnpm db:migrate
pnpm typecheck
PAYMENTS_ENABLED=false NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 pnpm build
PAYMENTS_ENABLED=false pnpm start --port 3009
```

In another terminal, run the complete suite against that same development database
and authentication secret:

```bash
TEST_BASE_URL=http://127.0.0.1:3009 \
TEST_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:54322/postgres' \
node --env-file=.env --test tests/*.test.mjs
```

Substitute your loopback development URL if different. Integration tests refuse
non-loopback destinations. They provision independent disposable accounts/staff,
exercise real HTTP/session/database behavior, and remove only their own fixtures.
Tests without integration settings explicitly skip those cases and are not full
verification. The Google Fonts system-CA setting preserves TLS verification in
this cloud environment. Neither Stripe key is required.

## Recorded validation

Validated against the local development PostgreSQL database and a production
Next.js server with payments disabled and both Stripe keys absent:

- Production build and `pnpm typecheck`: passed.
- Additive development migration and a second no-op migration run: passed.
- Complete automated suite: **57 passed, 0 failed, 0 skipped**. This includes
  independent accounts, ownership/CSRF/input boundaries, concurrent duplicate
  reactions and block/follow writes, approval revisions, private collections,
  reports/reviews, suspension/deletion, pagination, rates, demo isolation and
  disabled-payment regressions.
- Chromium end-to-end social workflow: drafting, submission, staff approval,
  follows/counts, likes, saves, comments/edits, report resolution, removal,
  appeal/restoration, generic-member blocking and published-edit reapproval passed.
- Persistence passed in separate browser contexts. A real logout/login through
  client navigation also confirmed that another account's cached saved posts do
  not flash while the next account's collection loads.
- Existing registration, login/logout, password changes, account settings,
  profile setup/editing/visibility/discovery, moderation, demo interactions and
  mobile navigation regression checks passed.
- **33 clean axe WCAG A/AA scans** across social (11), creator (10), and existing
  moderation (12) desktop/mobile states; no browser errors or mobile overflow.

Browser checks used disposable, independently authenticated fixtures in the local
database and removed only those fixtures afterward. No staff account, deployment,
or payment activation is created by these checks.

## Administrative configuration and remaining work

Existing staff permissions work without new secrets or a new role system. A trusted
operator must provision verified staff as documented in [Phase 2B](phase-two-b.md).
Staff approve the creator profile first, then its submitted text posts. Nothing
assigns moderator/admin privileges during registration. Response coverage,
least-privilege database grants, staff account security, retention and appeal
standards remain operating requirements before launch.

This phase does not provide live cross-device push, WebSockets, notification delivery,
threaded conversations, feed ranking, full-text search, cross-account/IP abuse
prevention, or automated content classification. Cross-device persistence is
verified by loading the same account in independent browser contexts; active views
refresh on actions, focus or navigation. Offset pagination can shift under concurrent
publication; keyset pagination is future scaling work. Counts use indexed subqueries
and may need dedicated aggregates at larger scale.

Media uploads still need separate storage/access design, upload validation,
processing/scanning, consent/privacy enforcement, content review and delivery
controls. There are no image/video uploads, HTML/Markdown posts, external embeds,
or direct messages here. Existing fictional media remains clearly demo content.
Payments and memberships stay disabled; no billing configuration is introduced.
