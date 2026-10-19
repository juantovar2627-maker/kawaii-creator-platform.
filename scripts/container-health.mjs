// Internal probe uses the same gate as requests. It creates no bypass endpoint.
import { request } from "node:http";
try {
  const base = new URL(process.env.BASE_URL);
  await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: process.env.PORT || 3000,
        path: "/api/admin/health",
        signal: AbortSignal.timeout(6500),
        headers: {
          Host: base.host,
          "X-Forwarded-Proto": "https",
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.STAGING_ACCESS_USERNAME}:${process.env.STAGING_ACCESS_PASSWORD}`,
            ).toString("base64"),
          "X-Mimi-Health-Token": process.env.HEALTHCHECK_TOKEN || "",
        },
      },
      (res) => {
        let bytes = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 4096) req.destroy(new Error("response limit"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            if (
              res.statusCode !== 200 ||
              JSON.parse(Buffer.concat(chunks).toString()).ready !== true
            )
              throw new Error("not ready");
            resolve();
          } catch {
            reject(new Error("not ready"));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
} catch {
  process.exitCode = 1;
}
