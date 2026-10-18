import "dotenv/config";
import { assertConfiguration } from "../lib/config/runtime";
import { pruneAuthWindows } from "../lib/ops/maintenance";
import { client } from "../lib/db/drizzle";
async function main() {
  try {
    assertConfiguration("cleanup");
    await pruneAuthWindows();
    console.log("Expired authentication windows pruned in a bounded batch.");
  } catch {
    console.error("Authentication maintenance unavailable.");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
void main();
