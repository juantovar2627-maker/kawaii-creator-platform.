import "dotenv/config";
import { assertConfiguration } from "../lib/config/runtime";
try {
  assertConfiguration();
  console.log(
    "Runtime configuration valid; dependency connectivity and operator attestations require separate verification.",
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
