CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"description" varchar(1000) NOT NULL,
	"transcript" text DEFAULT '' NOT NULL,
	"state" varchar(20) DEFAULT 'authorizing' NOT NULL,
	"moderation" varchar(20) DEFAULT 'pending' NOT NULL,
	"approved_revision" integer,
	"scan_status" varchar(30) DEFAULT 'not_scanned' NOT NULL,
	"scan_policy" varchar(120),
	"processor_mode" varchar(30),
	"source_key" text NOT NULL,
	"playback_key" text NOT NULL,
	"poster_key" text NOT NULL,
	"storage_driver" varchar(10) NOT NULL,
	"upload_id" text,
	"upload_token_hash" varchar(64) NOT NULL,
	"upload_expires_at" timestamp NOT NULL,
	"expected_bytes" integer NOT NULL,
	"source_bytes" integer DEFAULT 0 NOT NULL,
	"playback_bytes" integer DEFAULT 0 NOT NULL,
	"poster_bytes" integer DEFAULT 0 NOT NULL,
	"storage_bytes" integer DEFAULT 209715200 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"frame_rate" integer,
	"video_codec" varchar(30),
	"audio_codec" varchar(30),
	"source_sha256" varchar(64),
	"sha256" varchar(64),
	"error" varchar(300),
	"source_deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"purged_at" timestamp,
	CONSTRAINT "video_assets_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "video_assets_playback_key_unique" UNIQUE("playback_key"),
	CONSTRAINT "video_assets_poster_key_unique" UNIQUE("poster_key"),
	CONSTRAINT "video_state" CHECK ("video_assets"."state" in ('authorizing','reserved','uploading','uploaded','queued','processing','ready','failed','purged')),
	CONSTRAINT "video_moderation" CHECK ("video_assets"."moderation" in ('pending','approved','rejected','removed')),
	CONSTRAINT "video_scan" CHECK ("video_assets"."scan_status" in ('not_scanned','passed','development_manual','rejected','unavailable')),
	CONSTRAINT "video_driver" CHECK ("video_assets"."storage_driver" in ('local','s3')),
	CONSTRAINT "video_expected_size" CHECK ("video_assets"."expected_bytes" between 1 and 104857600),
	CONSTRAINT "video_quota_size" CHECK ("video_assets"."storage_bytes" between 0 and 209715200),
	CONSTRAINT "video_duration" CHECK ("video_assets"."duration_ms" is null or "video_assets"."duration_ms" between 1 and 60000)
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"state" varchar(20) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"worker_id" uuid,
	"lease_token" uuid,
	"lease_expires_at" timestamp,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"error" varchar(120),
	CONSTRAINT "video_jobs_asset_id_unique" UNIQUE("asset_id"),
	CONSTRAINT "video_job_state" CHECK ("video_jobs"."state" in ('queued','running','succeeded','failed','cancelled')),
	CONSTRAINT "video_job_attempts" CHECK ("video_jobs"."attempts" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "video_workers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(20) NOT NULL,
	"current_job_id" uuid,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_asset_id_video_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."video_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_worker_id_video_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."video_workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_video_per_post" ON "video_assets" USING btree ("post_id") WHERE "video_assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "video_owner_quota" ON "video_assets" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "video_cleanup" ON "video_assets" USING btree ("state","upload_expires_at");--> statement-breakpoint
CREATE INDEX "video_job_claim" ON "video_jobs" USING btree ("state","available_at","lease_expires_at");