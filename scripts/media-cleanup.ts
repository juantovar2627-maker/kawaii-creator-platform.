import "dotenv/config";
import { cleanupMedia } from "../lib/media/cleanup";
import { client } from "../lib/db/drizzle";
import { cleanupVideos, cleanupVideoWork } from "../lib/video/cleanup";
async function main() {
  try {
    if (
      process.argv
        .slice(2)
        .some((a) => !["--apply", "--dry-run"].includes(a)) ||
      (process.argv.includes("--apply") && process.argv.includes("--dry-run"))
    )
      throw new Error("Use --dry-run (default) or --apply.");
    console.log(
      JSON.stringify({
        ...(await cleanupMedia(process.argv.includes("--apply"))),
        videos: await cleanupVideos(process.argv.includes("--apply")),
        work: await cleanupVideoWork(process.argv.includes("--apply")),
      }),
    );
  } catch {
    console.error(
      "Media cleanup failed. Check private storage and database configuration; existing records were retained for retry.",
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
void main();
