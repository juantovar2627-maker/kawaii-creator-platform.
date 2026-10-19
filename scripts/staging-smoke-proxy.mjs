// Loopback CI ingress simulator, never a hosted proxy or access-control bypass.
import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
try {
  const c = JSON.parse(await readFile(process.env.STAGING_SMOKE_FILE, "utf8"));
  const local = new URL(c.baseUrl),
    upstream = new URL(process.env.TEST_STAGING_BASE_URL),
    canonical = new URL(c.canonicalOrigin);
  if (
    process.env.STAGING_SMOKE_FIXTURE !== "true" ||
    ![local, upstream, canonical].every((u) =>
      ["127.0.0.1", "localhost"].includes(u.hostname),
    ) ||
    local.protocol !== "http:" ||
    upstream.protocol !== "http:" ||
    canonical.protocol !== "https:" ||
    local.port === upstream.port
  )
    throw new Error("fixture");
  const server = createServer((req, res) => {
    const headers = {
      ...req.headers,
      host: canonical.host,
      "x-forwarded-host": canonical.host,
      "x-forwarded-proto": "https",
      "x-mimi-client-ip": "127.0.0.1",
    };
    delete headers.forwarded;
    delete headers["x-forwarded-for"];
    // Only the fixture browser origin maps to simulated HTTPS. Invalid origins stay invalid.
    if (headers.origin === local.origin) headers.origin = canonical.origin;
    const out = request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: req.url,
        method: req.method,
        headers,
        signal: AbortSignal.timeout(30000),
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    out.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on("error", () => out.destroy());
    req.pipe(out);
  });
  server.listen(Number(local.port), "127.0.0.1", () =>
    console.log("Loopback synthetic staging ingress simulator ready."),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => server.close(() => process.exit(0)));
} catch {
  console.error(
    "Loopback staging ingress simulator refused its settings; details withheld.",
  );
  process.exitCode = 1;
}
