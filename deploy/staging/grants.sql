-- Operator-reviewed, dedicated staging DB only. No roles/passwords are created.
-- psql --set ON_ERROR_STOP=1 --set app_role=mimi_staging_app --set db_name=mimi_staging --file deploy/staging/grants.sql
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('mimi.expected_database', :'db_name', true);
SELECT set_config('mimi.app_role', :'app_role', true);
DO $$
DECLARE r pg_roles;
BEGIN
  IF current_database() <> current_setting('mimi.expected_database') OR current_database() !~ '^mimi_[a-z0-9_]*staging[a-z0-9_]*$' THEN
    RAISE EXCEPTION 'An explicitly named, separate Mimi staging database is required';
  END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname=current_setting('mimi.app_role');
  IF r.oid IS NULL OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=r.oid) THEN
    RAISE EXCEPTION 'Dedicated non-owner, non-inheriting application role required';
  END IF;
END $$;
-- The DB is dedicated: PUBLIC must not supply write/schema privileges indirectly.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"db_name" FROM :"app_role";
REVOKE ALL ON SCHEMA public FROM :"app_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"app_role";
GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT ON users,teams,team_members,invitations,activity_logs,
  creator_profiles,creator_mutation_limits,platform_staff,profile_reports,
  moderation_audit,moderation_appeals,account_blocks,safety_rate_limits,
  creator_follows,social_posts,social_comments,post_likes,saved_posts,social_reports,
  social_appeals,media_assets,video_assets,video_jobs,video_workers,auth_rate_limits,service_runs TO :"app_role";
GRANT INSERT,UPDATE ON users TO :"app_role";
GRANT INSERT ON moderation_audit,activity_logs TO :"app_role";
GRANT INSERT,UPDATE,DELETE ON teams,team_members,invitations,creator_profiles,
  creator_mutation_limits,profile_reports,moderation_appeals,account_blocks,
  safety_rate_limits,creator_follows,social_posts,social_comments,post_likes,
  saved_posts,social_reports,social_appeals,media_assets,video_assets,video_jobs,
  auth_rate_limits TO :"app_role";
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
-- No default future-table grants: review this list after every migration.
COMMIT;
