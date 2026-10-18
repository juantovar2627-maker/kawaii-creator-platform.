import { spawn } from "node:child_process";
import { assertConfiguration, appMode, loopback } from "../lib/config/runtime";
import { assertApplicationDatabaseRole } from "../lib/ops/database-role";
async function main() {
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
  };
  assertConfiguration("app", env);
  if (appMode(env) !== "development") await assertApplicationDatabaseRole();
  const args = process.argv.slice(2);
  if (appMode(env) === "development") {
    const hosts = args.flatMap((arg, index) =>
      arg === "--hostname" || arg === "-H"
        ? [args[index + 1] || ""]
        : arg.startsWith("--hostname=")
          ? [arg.slice(11)]
          : [],
    );
    if (hosts.some((host) => !loopback(host)))
      throw new Error("Development serving requires a loopback bind.");
    if (!hosts.length) args.push("--hostname", "127.0.0.1");
  }
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", ...args],
    { env, stdio: "inherit" },
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Application startup failed. Details withheld.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "";
  console.error(
    message.startsWith("Invalid runtime configuration:") ||
      message.startsWith(
        "Application database security verification failed.",
      ) ||
      message === "Development serving requires a loopback bind."
      ? message
      : "Application startup failed. Details withheld.",
  );
  process.exitCode = 1;
});
