import "dotenv/config";
import { cleanupMedia } from "../lib/media/cleanup";
import { client } from "../lib/db/drizzle";
import { cleanupVideos, cleanupVideoWork } from "../lib/video/cleanup";
import { assertConfiguration } from "../lib/config/runtime";
import {
  startCleanup,
  finishCleanup,
  pruneAuthWindows,
} from "../lib/ops/maintenance";
import { operationalLog } from "../lib/ops/log";
async function main() {
  let run: string | undefined;
  const started = Date.now();
  try {
    assertConfiguration("cleanup");
    if (
      process.argv
        .slice(2)
        .some((a) => !["--apply", "--dry-run"].includes(a)) ||
      (process.argv.includes("--apply") && process.argv.includes("--dry-run"))
    )
      throw new Error("Invalid cleanup arguments.");
    const apply = process.argv.includes("--apply");
    if (apply) {
      run = await startCleanup();
      operationalLog("cleanup_started");
      await pruneAuthWindows();
    }
    const result = {
      ...(await cleanupMedia(apply)),
      videos: await cleanupVideos(apply),
      work: await cleanupVideoWork(apply),
    };
    if (run) {
      await finishCleanup(run, true);
      operationalLog("cleanup_succeeded", { durationMs: Date.now() - started });
    }
    console.log(JSON.stringify(result));
  } catch {
    if (run) await finishCleanup(run, false).catch(() => {});
    operationalLog("cleanup_failed", { durationMs: Date.now() - started });
    console.error(
      "Media cleanup failed. Existing references were retained for retry; check restricted diagnostics.",
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
void main();
