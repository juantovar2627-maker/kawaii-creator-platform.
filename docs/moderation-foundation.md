# Moderation foundation, not a live reporting service

Phase 1 exposes report and block menus on fictional creator cards, creator
profiles, and feed posts. Reports are explicitly local drafts. Blocks hide demo
creators from discovery, feed recommendations, posts and sample notifications
in the current browser. They do not provide account-level enforcement.

The reusable report dialog captures a target, reason, and optional details. It
has keyboard focus management, labeled inputs and a clear no-submission notice.
Reset local demo state from the account overview. Demo reports must never be
silently copied into a future production moderation queue.

Before real community content is enabled, design additive database tables and
authenticated APIs for:

- Reports with reporter ID, typed subject ID, reason, evidence references,
  timestamps, lifecycle status and an auditable resolution.
- Blocks with blocker/blocked account IDs, uniqueness rules, and server-side
  filtering across feeds, notifications and interactions.
- Restricted staff review with permissions, abuse-rate limits, audit logs,
  resolution notices, retention rules and appeals.
- Upload validation, access control, consent/privacy rules and enforcement of
  this community's non-explicit content policy.

Do not trust localStorage for enforcement, accept arbitrary account IDs without
authorization, expose reporter details publicly, or label a report submitted
until an authenticated backend confirms receipt. No schema changes or destructive
migrations are included in Phase 1.
