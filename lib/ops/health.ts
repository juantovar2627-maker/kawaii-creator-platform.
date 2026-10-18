import "server-only";
import postgres from "postgres";
import { databaseRoleQuery } from "./database-role";
import { appMode, uploadsEnabled, videosEnabled } from "@/lib/config/runtime";
import { videoStorage } from "@/lib/video/storage";
type Check = {
  status:
    | "ready"
    | "disabled"
    | "development_only"
    | "unavailable"
    | "unverified"
    | "stale"
    | "failed";
  [key: string]: string | number | null;
};
let connection: ReturnType<typeof postgres> | undefined;
const healthDb = () =>
  (connection ??= postgres(process.env.POSTGRES_URL!, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 2,
    connection: { statement_timeout: 3000 },
    onnotice: () => {},
  }));
async function scanner(kind: "photo" | "video"): Promise<Check> {
  if (
    appMode() === "development" &&
    process.env.MEDIA_SCAN_MODE === "development-manual"
  )
    return { status: "development_only" };
  const prefix = kind === "photo" ? "MEDIA" : "VIDEO";
  const url = process.env[prefix + "_SCANNER_HEALTH_URL"],
    token = process.env[prefix + "_SCANNER_TOKEN"];
  if (!url || !token) return { status: "unverified" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return { status: "unavailable" };
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok || !response.body) return { status: "unavailable" };
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 4096) {
        await reader.cancel();
        return { status: "unavailable" };
      }
      chunks.push(part.value);
    }
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const policy =
      kind === "photo" ? "mimi-non-explicit-v1" : "mimi-video-non-explicit-v1";
    return {
      status:
        v.status === "ready" &&
        v.policy === policy &&
        (kind === "photo" || (v.frames === "all" && v.audio === "all"))
          ? "ready"
          : "unavailable",
    };
  } catch {
    return { status: "unavailable" };
  }
}
export async function diagnostics() {
  const checks: Record<string, Check> = {
    application: { status: "ready" },
    database: { status: "unavailable" },
    databaseRole: { status: "unverified" },
    storage: { status: "disabled" },
    photoScanner: { status: "disabled" },
    videoScanner: { status: "disabled" },
    worker: { status: "disabled" },
    queue: { status: "disabled" },
    cleanup: { status: "disabled" },
  };
  const media =
    process.env.MEDIA_STORAGE_DRIVER === "s3" ||
    (uploadsEnabled() && process.env.MEDIA_STORAGE_DRIVER === "local");
  try {
    const sql = healthDb();
    await sql`select 1`;
    checks.database = { status: "ready" };
    const [role] = await sql.unsafe(databaseRoleQuery);
    checks.databaseRole = {
      status: role.unsafe
        ? appMode() === "development"
          ? "development_only"
          : "unavailable"
        : "ready",
    };
    if (videosEnabled()) {
      const [q] =
        await sql`select count(*) filter(where state='queued')::int queued,count(*) filter(where state='failed')::int failed,coalesce(extract(epoch from (now()-min(created_at) filter(where state='queued'))),0)::int oldest from video_jobs`;
      const [w] =
        await sql`select count(*)::int active from video_workers where status in ('idle','busy') and heartbeat_at>now()-interval '60 seconds'`;
      checks.worker = {
        status: w.active > 0 ? "ready" : "stale",
        active: w.active,
      };
      checks.queue = {
        status: q.oldest > 900 ? "stale" : q.failed > 0 ? "failed" : "ready",
        queued: q.queued,
        failed: q.failed,
        oldestSeconds: Math.max(0, q.oldest),
      };
    }
    if (media) {
      const [run] =
        await sql`select status,extract(epoch from(now()-coalesce(finished_at,started_at)))::int age from service_runs where service='media_cleanup'`;
      checks.cleanup = {
        status: !run
          ? "unverified"
          : run.status === "failed"
            ? "failed"
            : run.age > 900
              ? "stale"
              : run.status === "succeeded"
                ? "ready"
                : "unverified",
        ageSeconds: run ? Math.max(0, run.age) : null,
      };
    }
  } catch {
    /* Never expose driver errors, account data, hosts or credentials. */
  }
  if (media) {
    if (
      appMode() === "development" &&
      process.env.MEDIA_STORAGE_DRIVER === "local"
    )
      checks.storage = { status: "development_only" };
    else
      try {
        const key = process.env.MEDIA_HEALTHCHECK_KEY;
        if (!key) checks.storage = { status: "unverified" };
        else {
          const bytes = await videoStorage().head(
            key,
            AbortSignal.timeout(3000),
          );
          checks.storage = {
            status:
              bytes !== null && bytes > 0 && bytes <= 1024
                ? "ready"
                : "unavailable",
          };
        }
      } catch {
        checks.storage = { status: "unavailable" };
      }
  }
  if (uploadsEnabled() && media) checks.photoScanner = await scanner("photo");
  if (videosEnabled() && media) checks.videoScanner = await scanner("video");
  const ready = Object.values(checks).every((check) =>
    [
      "ready",
      "disabled",
      ...(appMode() === "development" ? ["development_only"] : []),
    ].includes(check.status),
  );
  return { ready, environment: appMode(), checks };
}
