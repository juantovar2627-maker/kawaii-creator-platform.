CREATE TABLE "creator_mutation_limits" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"window_started_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" varchar(30) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"biography" text DEFAULT '' NOT NULL,
	"theme" varchar(20) DEFAULT 'pink' NOT NULL,
	"avatar" varchar(20) DEFAULT 'flower' NOT NULL,
	"banner" varchar(20) DEFAULT 'blossom' NOT NULL,
	"categories" jsonb NOT NULL,
	"website_url" varchar(300) DEFAULT '' NOT NULL,
	"instagram_url" varchar(300) DEFAULT '' NOT NULL,
	"youtube_url" varchar(300) DEFAULT '' NOT NULL,
	"visibility" varchar(20) DEFAULT 'unlisted' NOT NULL,
	"moderation_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"community_accepted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "creator_username_format" CHECK ("creator_profiles"."username" ~ '^[a-z][a-z0-9_]{2,29}$'),
	CONSTRAINT "creator_visibility" CHECK ("creator_profiles"."visibility" in ('hidden', 'unlisted', 'listed')),
	CONSTRAINT "creator_moderation" CHECK ("creator_profiles"."moderation_status" in ('pending', 'approved', 'suspended')),
	CONSTRAINT "creator_theme" CHECK ("creator_profiles"."theme" in ('pink', 'lavender', 'peach', 'mint')),
	CONSTRAINT "creator_avatar" CHECK ("creator_profiles"."avatar" in ('flower', 'star', 'bow', 'cloud')),
	CONSTRAINT "creator_banner" CHECK ("creator_profiles"."banner" in ('blossom', 'daydream', 'sunrise'))
);
--> statement-breakpoint
ALTER TABLE "creator_mutation_limits" ADD CONSTRAINT "creator_mutation_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_username_lower_unique" ON "creator_profiles" USING btree (lower("username"));