CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"position" integer NOT NULL,
	"description" varchar(300) NOT NULL,
	"state" varchar(20) DEFAULT 'reserved' NOT NULL,
	"moderation" varchar(20) DEFAULT 'pending' NOT NULL,
	"approved_revision" integer,
	"scan_status" varchar(30) DEFAULT 'not_scanned' NOT NULL,
	"scan_policy" varchar(120),
	"display_key" text NOT NULL,
	"thumbnail_key" text NOT NULL,
	"storage_driver" varchar(10) NOT NULL,
	"upload_token_hash" varchar(64) NOT NULL,
	"upload_expires_at" timestamp NOT NULL,
	"storage_bytes" integer DEFAULT 10485760 NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" varchar(64),
	"error" varchar(300),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"purged_at" timestamp,
	CONSTRAINT "media_assets_display_key_unique" UNIQUE("display_key"),
	CONSTRAINT "media_assets_thumbnail_key_unique" UNIQUE("thumbnail_key"),
	CONSTRAINT "media_position" CHECK ("media_assets"."position" between 0 and 4),
	CONSTRAINT "media_state" CHECK ("media_assets"."state" in ('reserved','processing','ready','failed','purged')),
	CONSTRAINT "media_moderation" CHECK ("media_assets"."moderation" in ('pending','approved','rejected','removed')),
	CONSTRAINT "media_scan" CHECK ("media_assets"."scan_status" in ('not_scanned','development_manual','passed','rejected','unavailable')),
	CONSTRAINT "media_driver" CHECK ("media_assets"."storage_driver" in ('local','s3')),
	CONSTRAINT "media_size" CHECK ("media_assets"."storage_bytes" between 0 and 10485760)
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_owner_quota" ON "media_assets" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "media_post_order" ON "media_assets" USING btree ("post_id","position");--> statement-breakpoint
CREATE INDEX "media_cleanup" ON "media_assets" USING btree ("state","upload_expires_at");