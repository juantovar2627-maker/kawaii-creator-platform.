// Keep pnpm alive while the validated application entrypoint drains Next.
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
const args = process.argv.slice(2),
  web = args[0] === "pnpm" && args[1] === "start";
const pidFile = "/tmp/mimi-start.pid";
if (web) rmSync(pidFile, { force: true });
const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: { ...process.env, ...(web ? { MIMI_CONTAINER_PID_FILE: pidFile } : {}) },
});
let timer,
  forwarded = false;
function stop(signal) {
  if (!web) {
    child.kill(signal);
    return;
  }
  if (forwarded) return;
  try {
    const pid = Number(readFileSync(pidFile, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 2 || pid === process.pid)
      throw new Error("pid");
    process.kill(pid, signal);
    forwarded = true;
    clearInterval(timer);
  } catch {
    timer ??= setInterval(() => stop(signal), 25);
  }
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => stop(signal));
child.on("error", () => {
  clearInterval(timer);
  console.error("Container command failed; details withheld.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  clearInterval(timer);
  if (web) rmSync(pidFile, { force: true });
  process.exitCode = code ?? 1;
});
