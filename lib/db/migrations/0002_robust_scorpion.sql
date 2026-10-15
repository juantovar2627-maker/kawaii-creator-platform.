CREATE TABLE "account_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"blocker_id" integer NOT NULL,
	"blocked_id" integer NOT NULL,
	"target_username" varchar(30) NOT NULL,
	"target_display_name" varchar(80) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "no_self_block" CHECK ("account_blocks"."blocker_id" <> "account_blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"decision_id" integer NOT NULL,
	"explanation" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	CONSTRAINT "moderation_appeals_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "appeal_status" CHECK ("moderation_appeals"."status" in ('open', 'reviewed'))
);
--> statement-breakpoint
CREATE TABLE "moderation_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_role" varchar(20) NOT NULL,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"profile_id" integer,
	"reason" text NOT NULL,
	"internal_note" text DEFAULT '' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"role" varchar(20) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_role" CHECK ("platform_staff"."role" in ('admin', 'moderator'))
);
--> statement-breakpoint
CREATE TABLE "profile_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"target_username" varchar(30) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	CONSTRAINT "report_status" CHECK ("profile_reports"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "safety_rate_limits" (
	"user_id" integer NOT NULL,
	"scope" varchar(20) NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_rate_limits_user_id_scope_pk" PRIMARY KEY("user_id","scope")
);
--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "listing_rejected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "moderation_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_blocks" ADD CONSTRAINT "account_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_blocks" ADD CONSTRAINT "account_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_profile_id_creator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."creator_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decision_id_moderation_audit_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."moderation_audit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_audit" ADD CONSTRAINT "moderation_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_audit" ADD CONSTRAINT "moderation_audit_profile_id_creator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."creator_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_profile_id_creator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."creator_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_reports" ADD CONSTRAINT "profile_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_rate_limits" ADD CONSTRAINT "safety_rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_account_block" ON "account_blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "blocks_target" ON "account_blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "appeals_queue" ON "moderation_appeals" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "audit_profile_history" ON "moderation_audit" USING btree ("profile_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_report_per_member_profile" ON "profile_reports" USING btree ("reporter_id","profile_id") WHERE "profile_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reports_queue" ON "profile_reports" USING btree ("status","id");