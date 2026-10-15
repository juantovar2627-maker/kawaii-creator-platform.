import { setTimeout as delay } from "node:timers/promises";
import "dotenv/config";
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
    if (process.argv.slice(2).some((a) => a !== "--once"))
      throw new Error("Use --once or no arguments.");
    do {
      const result = await runWorkerOnce(workerId, stop.signal);
      if (result.jobId || process.argv.includes("--once"))
        console.log(JSON.stringify(result));
      if (process.argv.includes("--once")) break;
      await delay(2000, undefined, { signal: stop.signal }).catch(() => {});
    } while (!stop.signal.aborted);
  } catch {
    console.error(
      "Video worker unavailable. Check private storage, PostgreSQL, work directory and isolated FFmpeg runtime.",
    );
    process.exitCode = 1;
  } finally {
    await db
      .update(videoWorkers)
      .set({ status: "stopped", currentJobId: null, heartbeatAt: new Date() })
      .where(eq(videoWorkers.id, workerId));
    await client.end();
  }
}
void main();
