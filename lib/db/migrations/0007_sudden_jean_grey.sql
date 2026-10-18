CREATE TABLE "auth_rate_limits" (
	"scope" varchar(40) NOT NULL,
	"subject_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_scope_subject_hash_pk" PRIMARY KEY("scope","subject_hash")
);
--> statement-breakpoint
CREATE TABLE "service_runs" (
	"service" varchar(40) PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "service_run_status" CHECK ("service_runs"."status" in ('running','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_rate_expiry" ON "auth_rate_limits" USING btree ("started_at");