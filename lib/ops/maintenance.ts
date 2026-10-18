import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
export async function startCleanup() {
  const id = randomUUID();
  const rows = await db.execute(
    sql`insert into service_runs(service,run_id,status,started_at,finished_at) values('media_cleanup',${id}::uuid,'running',now(),null) on conflict(service) do update set run_id=excluded.run_id,status='running',started_at=now(),finished_at=null where service_runs.status<>'running' or service_runs.started_at<now()-interval '10 minutes' returning run_id`,
  );
  if (!rows.length) throw new Error("Cleanup already running.");
  return id;
}
export async function finishCleanup(id: string, success: boolean) {
  await db.execute(
    sql`update service_runs set status=${success ? "succeeded" : "failed"},finished_at=now() where service='media_cleanup' and run_id=${id}::uuid`,
  );
}
export async function pruneAuthWindows() {
  return db.execute(
    sql`delete from auth_rate_limits where (scope,subject_hash) in (select scope,subject_hash from auth_rate_limits where started_at<now()-interval '24 hours' order by started_at limit 1000)`,
  );
}
