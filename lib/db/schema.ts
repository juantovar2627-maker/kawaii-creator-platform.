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
