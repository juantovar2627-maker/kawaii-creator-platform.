import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  check,
  boolean,
  index,
  primaryKey,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type {
  Avatar,
  Banner,
  CreatorCategory,
  Theme,
  Visibility,
} from '../creators/presets';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  sessionVersion: integer('session_version').notNull().default(0),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

// Additive opt-in extension. Existing authentication/account tables stay intact.
export const creatorProfiles = pgTable(
  'creator_profiles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    username: varchar('username', { length: 30 }).notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    biography: text('biography').notNull().default(''),
    theme: varchar('theme', { length: 20 })
      .$type<Theme>()
      .notNull()
      .default('pink'),
    avatar: varchar('avatar', { length: 20 })
      .$type<Avatar>()
      .notNull()
      .default('flower'),
    banner: varchar('banner', { length: 20 })
      .$type<Banner>()
      .notNull()
      .default('blossom'),
    categories: jsonb('categories').$type<CreatorCategory[]>().notNull(),
    websiteUrl: varchar('website_url', { length: 300 }).notNull().default(''),
    instagramUrl: varchar('instagram_url', { length: 300 })
      .notNull()
      .default(''),
    youtubeUrl: varchar('youtube_url', { length: 300 }).notNull().default(''),
    visibility: varchar('visibility', { length: 20 })
      .$type<Visibility>()
      .notNull()
      .default('unlisted'),
    // Never accepted from a public mutation. Review tooling is a Phase 2B task.
    moderationStatus: varchar('moderation_status', { length: 20 })
      .$type<'pending' | 'approved' | 'suspended'>()
      .notNull()
      .default('pending'),
    communityAcceptedAt: timestamp('community_accepted_at')
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    revision: integer('revision').notNull().default(1),
    listingRejected: boolean('listing_rejected').notNull().default(false),
    moderationReason: text('moderation_reason').notNull().default(''),
  },
  (table) => [
    uniqueIndex('creator_profiles_username_lower_unique').on(
      sql`lower(${table.username})`,
    ),
    check(
      'creator_username_format',
      sql`${table.username} ~ '^[a-z][a-z0-9_]{2,29}$'`,
    ),
    check(
      'creator_visibility',
      sql`${table.visibility} in ('hidden', 'unlisted', 'listed')`,
    ),
    check(
      'creator_moderation',
      sql`${table.moderationStatus} in ('pending', 'approved', 'suspended')`,
    ),
    check(
      'creator_theme',
      sql`${table.theme} in ('pink', 'lavender', 'peach', 'mint')`,
    ),
    check(
      'creator_avatar',
      sql`${table.avatar} in ('flower', 'star', 'bow', 'cloud')`,
    ),
    check(
      'creator_banner',
      sql`${table.banner} in ('blossom', 'daydream', 'sunrise')`,
    ),
    index('creator_listing_queue').on(
      table.moderationStatus,
      table.visibility,
      table.listingRejected,
      table.id,
    ),
  ],
);

// One persistent row per account; concurrent instances share the same limit.
export const creatorMutationLimits = pgTable('creator_mutation_limits', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  windowStartedAt: timestamp('window_started_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(1),
});

// Platform staff are independent of SaaS team/user roles. Only the trusted
// database operator provisioning script writes this table; no public role API.
export const platformStaff = pgTable(
  'platform_staff',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id),
    role: varchar('role', { length: 20 })
      .$type<'admin' | 'moderator'>()
      .notNull(),
    active: boolean('active').notNull().default(true),
    grantedAt: timestamp('granted_at').notNull().defaultNow(),
  },
  (t) => [
    check('platform_staff_role', sql`${t.role} in ('admin', 'moderator')`),
  ],
);

export const profileReports = pgTable(
  'profile_reports',
  {
    id: serial('id').primaryKey(),
    reporterId: integer('reporter_id')
      .notNull()
      .references(() => users.id),
    profileId: integer('profile_id')
      .notNull()
      .references(() => creatorProfiles.id),
    targetUsername: varchar('target_username', { length: 30 }).notNull(),
    reason: varchar('reason', { length: 40 }).notNull(),
    explanation: text('explanation').notNull().default(''),
    snapshot: jsonb('snapshot')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: varchar('status', { length: 20 })
      .$type<'open' | 'resolved' | 'dismissed'>()
      .notNull()
      .default('open'),
    resolution: text('resolution').notNull().default(''),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (t) => [
    uniqueIndex('one_open_report_per_member_profile')
      .on(t.reporterId, t.profileId)
      .where(sql`${t.status} = 'open'`),
    index('reports_queue').on(t.status, t.id),
    check(
      'report_status',
      sql`${t.status} in ('open', 'resolved', 'dismissed')`,
    ),
  ],
);

export const moderationAudit = pgTable(
  'moderation_audit',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id),
    actorRole: varchar('actor_role', { length: 20 }).notNull(),
    action: varchar('action', { length: 50 }).notNull(),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: integer('entity_id').notNull(),
    profileId: integer('profile_id').references(() => creatorProfiles.id),
    reason: text('reason').notNull(),
    internalNote: text('internal_note').notNull().default(''),
    snapshot: jsonb('snapshot')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_profile_history').on(t.profileId, t.id)],
);

export const moderationAppeals = pgTable(
  'moderation_appeals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    profileId: integer('profile_id')
      .notNull()
      .references(() => creatorProfiles.id),
    decisionId: integer('decision_id')
      .notNull()
      .unique()
      .references(() => moderationAudit.id),
    explanation: text('explanation').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'open' | 'reviewed'>()
      .notNull()
      .default('open'),
    resolution: text('resolution').notNull().default(''),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (t) => [
    index('appeals_queue').on(t.status, t.id),
    check('appeal_status', sql`${t.status} in ('open', 'reviewed')`),
  ],
);

export const accountBlocks = pgTable(
  'account_blocks',
  {
    id: serial('id').primaryKey(),
    blockerId: integer('blocker_id')
      .notNull()
      .references(() => users.id),
    blockedId: integer('blocked_id')
      .notNull()
      .references(() => users.id),
    targetUsername: varchar('target_username', { length: 30 }).notNull(),
    targetDisplayName: varchar('target_display_name', { length: 80 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('unique_account_block').on(t.blockerId, t.blockedId),
    index('blocks_target').on(t.blockedId),
    check('no_self_block', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

export const safetyRateLimits = pgTable(
  'safety_rate_limits',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    scope: varchar('scope', { length: 20 }).notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope] })],
);

export const creatorFollows = pgTable(
  'creator_follows',
  {
    followerId: integer('follower_id')
      .notNull()
      .references(() => users.id),
    creatorId: integer('creator_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.creatorId] }),
    index('followers_creator').on(t.creatorId),
    check('no_self_follow', sql`${t.followerId} <> ${t.creatorId}`),
  ],
);

export const socialPosts = pgTable(
  'social_posts',
  {
    id: serial('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => creatorProfiles.id),
    title: varchar('title', { length: 120 }).notNull().default(''),
    body: text('body').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'draft' | 'pending' | 'published' | 'rejected' | 'removed'>()
      .notNull()
      .default('draft'),
    revision: integer('revision').notNull().default(1),
    moderationReason: text('moderation_reason').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    publishedAt: timestamp('published_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    index('social_posts_feed').on(t.status, t.publishedAt, t.id),
    index('social_posts_owner').on(t.profileId, t.id),
    check(
      'social_post_status',
      sql`${t.status} in ('draft','pending','published','rejected','removed')`,
    ),
    check('social_post_body_length', sql`length(${t.body}) between 1 and 4000`),
  ],
);

export const socialComments = pgTable(
  'social_comments',
  {
    id: serial('id').primaryKey(),
    postId: integer('post_id')
      .notNull()
      .references(() => socialPosts.id),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'visible' | 'removed'>()
      .notNull()
      .default('visible'),
    revision: integer('revision').notNull().default(1),
    moderationReason: text('moderation_reason').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    index('comments_post_page').on(t.postId, t.id),
    index('comments_author').on(t.authorId),
    check('social_comment_status', sql`${t.status} in ('visible','removed')`),
    check(
      'social_comment_body_length',
      sql`length(${t.body}) between 1 and 600`,
    ),
  ],
);

export const postLikes = pgTable(
  'post_likes',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    postId: integer('post_id')
      .notNull()
      .references(() => socialPosts.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index('likes_post').on(t.postId),
  ],
);
export const savedPosts = pgTable(
  'saved_posts',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    postId: integer('post_id')
      .notNull()
      .references(() => socialPosts.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

export const socialReports = pgTable(
  'social_reports',
  {
    id: serial('id').primaryKey(),
    reporterId: integer('reporter_id')
      .notNull()
      .references(() => users.id),
    postId: integer('post_id').references(() => socialPosts.id),
    commentId: integer('comment_id').references(() => socialComments.id),
    reason: varchar('reason', { length: 40 }).notNull(),
    explanation: text('explanation').notNull().default(''),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 20 })
      .$type<'open' | 'resolved' | 'dismissed'>()
      .notNull()
      .default('open'),
    resolution: text('resolution').notNull().default(''),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (t) => [
    check(
      'social_report_target',
      sql`(${t.postId} is not null)::int + (${t.commentId} is not null)::int = 1`,
    ),
    check(
      'social_report_status',
      sql`${t.status} in ('open','resolved','dismissed')`,
    ),
    uniqueIndex('one_open_post_report')
      .on(t.reporterId, t.postId)
      .where(sql`${t.status}='open'`),
    uniqueIndex('one_open_comment_report')
      .on(t.reporterId, t.commentId)
      .where(sql`${t.status}='open'`),
    index('social_reports_queue').on(t.status, t.id),
  ],
);

export const socialAppeals = pgTable(
  'social_appeals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    decisionId: integer('decision_id')
      .notNull()
      .unique()
      .references(() => moderationAudit.id),
    explanation: text('explanation').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'open' | 'reviewed'>()
      .notNull()
      .default('open'),
    resolution: text('resolution').notNull().default(''),
    reviewedBy: integer('reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at'),
  },
  (t) => [
    index('social_appeals_queue').on(t.status, t.id),
    check('social_appeal_status', sql`${t.status} in ('open','reviewed')`),
  ],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey(),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id),
    postId: integer('post_id')
      .notNull()
      .references(() => socialPosts.id),
    position: integer('position').notNull(),
    description: varchar('description', { length: 300 }).notNull(),
    state: varchar('state', { length: 20 })
      .$type<'reserved' | 'processing' | 'ready' | 'failed' | 'purged'>()
      .notNull()
      .default('reserved'),
    moderation: varchar('moderation', { length: 20 })
      .$type<'pending' | 'approved' | 'rejected' | 'removed'>()
      .notNull()
      .default('pending'),
    approvedRevision: integer('approved_revision'),
    scanStatus: varchar('scan_status', { length: 30 })
      .$type<
        | 'not_scanned'
        | 'development_manual'
        | 'passed'
        | 'rejected'
        | 'unavailable'
      >()
      .notNull()
      .default('not_scanned'),
    scanPolicy: varchar('scan_policy', { length: 120 }),
    displayKey: text('display_key').notNull().unique(),
    thumbnailKey: text('thumbnail_key').notNull().unique(),
    storageDriver: varchar('storage_driver', { length: 10 })
      .$type<'local' | 's3'>()
      .notNull(),
    uploadTokenHash: varchar('upload_token_hash', { length: 64 }).notNull(),
    uploadExpiresAt: timestamp('upload_expires_at').notNull(),
    storageBytes: integer('storage_bytes').notNull().default(10485760),
    width: integer('width'),
    height: integer('height'),
    sha256: varchar('sha256', { length: 64 }),
    error: varchar('error', { length: 300 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
    purgedAt: timestamp('purged_at'),
  },
  (t) => [
    index('media_owner_quota').on(t.ownerId, t.state),
    index('media_post_order').on(t.postId, t.position),
    index('media_cleanup').on(t.state, t.uploadExpiresAt),
    check('media_position', sql`${t.position} between 0 and 4`),
    check(
      'media_state',
      sql`${t.state} in ('reserved','processing','ready','failed','purged')`,
    ),
    check(
      'media_moderation',
      sql`${t.moderation} in ('pending','approved','rejected','removed')`,
    ),
    check(
      'media_scan',
      sql`${t.scanStatus} in ('not_scanned','development_manual','passed','rejected','unavailable')`,
    ),
    check('media_driver', sql`${t.storageDriver} in ('local','s3')`),
    check('media_size', sql`${t.storageBytes} between 0 and 10485760`),
  ],
);

export const videoAssets = pgTable(
  'video_assets',
  {
    id: uuid('id').primaryKey(),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id),
    postId: integer('post_id')
      .notNull()
      .references(() => socialPosts.id),
    description: varchar('description', { length: 1000 }).notNull(),
    transcript: text('transcript').notNull().default(''),
    state: varchar('state', { length: 20 }).notNull().default('authorizing'),
    moderation: varchar('moderation', { length: 20 })
      .notNull()
      .default('pending'),
    approvedRevision: integer('approved_revision'),
    scanStatus: varchar('scan_status', { length: 30 })
      .notNull()
      .default('not_scanned'),
    scanPolicy: varchar('scan_policy', { length: 120 }),
    processorMode: varchar('processor_mode', { length: 30 }),
    sourceKey: text('source_key').notNull().unique(),
    playbackKey: text('playback_key').notNull().unique(),
    posterKey: text('poster_key').notNull().unique(),
    storageDriver: varchar('storage_driver', { length: 10 }).notNull(),
    uploadId: text('upload_id'),
    uploadTokenHash: varchar('upload_token_hash', { length: 64 }).notNull(),
    uploadExpiresAt: timestamp('upload_expires_at').notNull(),
    expectedBytes: integer('expected_bytes').notNull(),
    sourceBytes: integer('source_bytes').notNull().default(0),
    playbackBytes: integer('playback_bytes').notNull().default(0),
    posterBytes: integer('poster_bytes').notNull().default(0),
    storageBytes: integer('storage_bytes').notNull().default(209715200),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    frameRate: integer('frame_rate'),
    videoCodec: varchar('video_codec', { length: 30 }),
    audioCodec: varchar('audio_codec', { length: 30 }),
    sourceSha256: varchar('source_sha256', { length: 64 }),
    sha256: varchar('sha256', { length: 64 }),
    error: varchar('error', { length: 300 }),
    sourceDeletedAt: timestamp('source_deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
    purgedAt: timestamp('purged_at'),
  },
  (t) => [
    uniqueIndex('one_active_video_per_post')
      .on(t.postId)
      .where(sql`${t.deletedAt} is null`),
    index('video_owner_quota').on(t.ownerId, t.state),
    index('video_cleanup').on(t.state, t.uploadExpiresAt),
    check(
      'video_state',
      sql`${t.state} in ('authorizing','reserved','uploading','uploaded','queued','processing','ready','failed','purged')`,
    ),
    check(
      'video_moderation',
      sql`${t.moderation} in ('pending','approved','rejected','removed')`,
    ),
    check(
      'video_scan',
      sql`${t.scanStatus} in ('not_scanned','passed','development_manual','rejected','unavailable')`,
    ),
    check('video_driver', sql`${t.storageDriver} in ('local','s3')`),
    check(
      'video_expected_size',
      sql`${t.expectedBytes} between 1 and 104857600`,
    ),
    check('video_quota_size', sql`${t.storageBytes} between 0 and 209715200`),
    check(
      'video_duration',
      sql`${t.durationMs} is null or ${t.durationMs} between 1 and 60000`,
    ),
  ],
);
export const videoWorkers = pgTable('video_workers', {
  id: uuid('id').primaryKey(),
  status: varchar('status', { length: 20 }).notNull(),
  currentJobId: uuid('current_job_id'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at').notNull().defaultNow(),
});
export const videoJobs = pgTable(
  'video_jobs',
  {
    id: uuid('id').primaryKey(),
    assetId: uuid('asset_id')
      .notNull()
      .unique()
      .references(() => videoAssets.id),
    state: varchar('state', { length: 20 }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    workerId: uuid('worker_id').references(() => videoWorkers.id),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    availableAt: timestamp('available_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    error: varchar('error', { length: 120 }),
  },
  (t) => [
    index('video_job_claim').on(t.state, t.availableAt, t.leaseExpiresAt),
    check(
      'video_job_state',
      sql`${t.state} in ('queued','running','succeeded','failed','cancelled')`,
    ),
    check('video_job_attempts', sql`${t.attempts} between 0 and 3`),
  ],
);

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
});

export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  role: varchar('role', { length: 50 }).notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
});

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitationsSent: many(invitations),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, 'id' | 'name' | 'email'>;
  })[];
};

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
}

// HMAC subjects contain no raw email/client address. Expired windows are pruned.
export const authRateLimits = pgTable('auth_rate_limits', {
  scope: varchar('scope', { length: 40 }).notNull(),
  subjectHash: varchar('subject_hash', { length: 64 }).notNull(),
  attempts: integer('attempts').notNull().default(1),
  startedAt: timestamp('started_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.scope, t.subjectHash] }), index('auth_rate_expiry').on(t.startedAt)]);
export const serviceRuns = pgTable('service_runs', {
  service: varchar('service', { length: 40 }).primaryKey(),
  runId: uuid('run_id').notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
}, (t) => [check('service_run_status', sql`${t.status} in ('running','succeeded','failed')`)]);
