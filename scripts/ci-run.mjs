// GitHub masks cannot recognize newly minted JWTs automatically.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
const secrets = [];
for (const [key, value] of Object.entries(process.env))
  if (/SECRET|PASSWORD|TOKEN|POSTGRES_URL/.test(key) && value?.length >= 8)
    secrets.push(value);
try {
  for (const line of readFileSync(
    process.env.TEST_STAGING_ENV_FILE,
    "utf8",
  ).split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && /SECRET|PASSWORD|TOKEN|POSTGRES_URL/.test(line.slice(0, at)))
      secrets.push(line.slice(at + 1));
  }
} catch {}
try {
  const c = JSON.parse(readFileSync(process.env.STAGING_SMOKE_FILE, "utf8"));
  secrets.push(
    c.basicPassword,
    c.accessClientSecret,
    ...c.accounts.map((a) => a.password),
  );
} catch {}
function redact(line) {
  for (const secret of secrets.filter(
    (s) => typeof s === "string" && s.length >= 8,
  ))
    line = line.split(secret).join("[redacted secret]");
  return line
    .replace(
      /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/g,
      "[redacted token]",
    )
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[redacted database URL]");
}
const args = process.argv.slice(2),
  child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
function forward(stream, target) {
  const decoder = new StringDecoder("utf8");
  let buffer = "",
    dropping = false;
  function accept(text) {
    for (const part of text.split(/(?<=\n)/)) {
      if (!dropping) buffer += part;
      if (buffer.length > 65536) {
        target.write("[oversized CI output withheld]\n");
        buffer = "";
        dropping = true;
      }
      if (part.endsWith("\n")) {
        if (!dropping) target.write(redact(buffer));
        buffer = "";
        dropping = false;
      }
    }
  }
  stream.on("data", (chunk) => accept(decoder.write(chunk)));
  stream.on("end", () => {
    accept(decoder.end());
    if (buffer && !dropping) target.write(redact(buffer));
  });
}
forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("CI command failed to start; details withheld.");
  process.exitCode = 1;
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
