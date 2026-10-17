import { setTimeout as delay } from "node:timers/promises";
import "dotenv/config";
import { assertConfiguration, videosEnabled } from "../lib/config/runtime";
import { operationalLog } from "../lib/ops/log";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWorkerOnce } from "../lib/video/worker";
import { db, client } from "../lib/db/drizzle";
import { videoWorkers } from "../lib/db/schema";
async function main() {
  const workerId = randomUUID(),
    stop = new AbortController();
  process.on("SIGTERM", () => stop.abort());
  process.on("SIGINT", () => stop.abort());
  try {
    assertConfiguration("worker");
    if (!videosEnabled()) throw new Error("Video processing is disabled.");
    if (process.argv.slice(2).some((a) => a !== "--once"))
      throw new Error("Use --once or no arguments.");
    do {
      const result = await runWorkerOnce(workerId, stop.signal);
      if (result.jobId || process.argv.includes("--once")) {
        operationalLog("worker_result", {
          jobClaimed: !!result.jobId,
          state: result.state as
            | "idle"
            | "queued"
            | "succeeded"
            | "failed"
            | "cancelled",
        });
        console.log(JSON.stringify(result));
      }
      if (process.argv.includes("--once")) break;
      await delay(2000, undefined, { signal: stop.signal }).catch(() => {});
    } while (!stop.signal.aborted);
  } catch {
    console.error(
      "Video worker unavailable. Check private storage, PostgreSQL, work directory and isolated FFmpeg runtime.",
    );
    process.exitCode = 1;
  } finally {
    try {
      await db
        .update(videoWorkers)
        .set({ status: "stopped", currentJobId: null, heartbeatAt: new Date() })
        .where(eq(videoWorkers.id, workerId));
    } catch {
      console.error(
        "Worker status could not be recorded; lease recovery remains required.",
      );
    }
    await client.end().catch(() => {});
  }
}
void main();
