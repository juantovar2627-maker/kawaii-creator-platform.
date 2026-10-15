CREATE TABLE "creator_follows" (
	"follower_id" integer NOT NULL,
	"creator_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creator_follows_follower_id_creator_id_pk" PRIMARY KEY("follower_id","creator_id"),
	CONSTRAINT "no_self_follow" CHECK ("creator_follows"."follower_id" <> "creator_follows"."creator_id")
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"user_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "saved_posts" (
	"user_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_posts_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "social_appeals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"decision_id" integer NOT NULL,
	"explanation" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	CONSTRAINT "social_appeals_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "social_appeal_status" CHECK ("social_appeals"."status" in ('open','reviewed'))
);
--> statement-breakpoint
CREATE TABLE "social_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'visible' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"moderation_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "social_comment_status" CHECK ("social_comments"."status" in ('visible','removed')),
	CONSTRAINT "social_comment_body_length" CHECK (length("social_comments"."body") between 1 and 600)
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"title" varchar(120) DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"moderation_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"deleted_at" timestamp,
	CONSTRAINT "social_post_status" CHECK ("social_posts"."status" in ('draft','pending','published','rejected','removed')),
	CONSTRAINT "social_post_body_length" CHECK (length("social_posts"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "social_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reporter_id" integer NOT NULL,
	"post_id" integer,
	"comment_id" integer,
	"reason" varchar(40) NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	CONSTRAINT "social_report_target" CHECK (("social_reports"."post_id" is not null)::int + ("social_reports"."comment_id" is not null)::int = 1),
	CONSTRAINT "social_report_status" CHECK ("social_reports"."status" in ('open','resolved','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "creator_follows" ADD CONSTRAINT "creator_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_follows" ADD CONSTRAINT "creator_follows_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_posts" ADD CONSTRAINT "saved_posts_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_appeals" ADD CONSTRAINT "social_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_appeals" ADD CONSTRAINT "social_appeals_decision_id_moderation_audit_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."moderation_audit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_appeals" ADD CONSTRAINT "social_appeals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_profile_id_creator_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."creator_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_comment_id_social_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."social_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followers_creator" ON "creator_follows" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "likes_post" ON "post_likes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_appeals_queue" ON "social_appeals" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "comments_post_page" ON "social_comments" USING btree ("post_id","id");--> statement-breakpoint
CREATE INDEX "comments_author" ON "social_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "social_posts_feed" ON "social_posts" USING btree ("status","published_at","id");--> statement-breakpoint
CREATE INDEX "social_posts_owner" ON "social_posts" USING btree ("profile_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_post_report" ON "social_reports" USING btree ("reporter_id","post_id") WHERE "social_reports"."status"='open';--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_comment_report" ON "social_reports" USING btree ("reporter_id","comment_id") WHERE "social_reports"."status"='open';--> statement-breakpoint
CREATE INDEX "social_reports_queue" ON "social_reports" USING btree ("status","id");