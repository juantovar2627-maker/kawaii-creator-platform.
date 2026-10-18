import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as httpsRequest } from "node:https";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
const exec = promisify(execFile);
test(
  "S3-compatible quarantine protocol: scoped upload part, server verification, consumed authorization and cleanup",
  { skip: !process.env.TEST_BASE_URL },
  async () => {
    const tmp = await mkdtemp(join(tmpdir(), "video-s3-test-"));
    let server;
    const uploads = new Map(),
      objects = new Map();
    const key = randomBytes(32).toString("hex") + ".bin";
    const access = randomBytes(12).toString("hex"),
      secret = randomBytes(32).toString("hex");
    let signedParts = 0,
      abortCount = 0;
    try {
      await exec(
        "/usr/bin/openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          join(tmp, "key.pem"),
          "-out",
          join(tmp, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { timeout: 15000 },
      );
      server = createServer(
        {
          key: await readFile(join(tmp, "key.pem")),
          cert: await readFile(join(tmp, "cert.pem")),
        },
        async (req, res) => {
          const url = new URL(req.url, "https://127.0.0.1"),
            object = decodeURIComponent(
              url.pathname.split("/").slice(2).join("/"),
            );
          const xml = (body, status = 200) => {
            res.writeHead(status, { "Content-Type": "application/xml" });
            res.end(body);
          };
          const fail = (name = "NoSuchUpload") =>
            xml(
              `<Error><Code>${name}</Code><Message>Fixture operation rejected</Message></Error>`,
              404,
            );
          try {
            const parts = [];
            for await (const chunk of req) parts.push(chunk);
            const bytes = Buffer.concat(parts);
            if (req.method === "POST" && url.searchParams.has("uploads")) {
              const id = randomUUID();
              uploads.set(id, { key: object, part: null });
              return xml(
                `<InitiateMultipartUploadResult><Bucket>private</Bucket><Key>${object}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
              );
            }
            if (req.method === "PUT" && url.searchParams.has("uploadId")) {
              const id = url.searchParams.get("uploadId"),
                upload = uploads.get(id);
              if (!upload || upload.key !== object) return fail();
              assert.equal(url.searchParams.get("partNumber"), "1");
              assert.ok(Number(url.searchParams.get("X-Amz-Expires")) <= 900);
              assert.match(
                url.searchParams.get("X-Amz-SignedHeaders"),
                /content-length/,
              );
              assert.match(
                url.searchParams.get("X-Amz-Credential"),
                new RegExp("^" + access + "/"),
              );
              assert.equal(Number(req.headers["content-length"]), bytes.length);
              upload.part = bytes;
              signedParts++;
              const etag =
                '"' + createHash("md5").update(bytes).digest("hex") + '"';
              upload.etag = etag;
              res.writeHead(200, { ETag: etag });
              res.end();
              return;
            }
            if (req.method === "GET" && url.searchParams.has("uploadId")) {
              const upload = uploads.get(url.searchParams.get("uploadId"));
              if (!upload) return fail();
              return xml(
                `<ListPartsResult><Bucket>private</Bucket><Key>${object}</Key><UploadId>${url.searchParams.get("uploadId")}</UploadId><IsTruncated>false</IsTruncated>${upload.part ? `<Part><PartNumber>1</PartNumber><ETag>${upload.etag.replaceAll('"', "&quot;")}</ETag><Size>${upload.part.length}</Size></Part>` : ""}</ListPartsResult>`,
              );
            }
            if (req.method === "POST" && url.searchParams.has("uploadId")) {
              const id = url.searchParams.get("uploadId"),
                upload = uploads.get(id);
              if (!upload || !upload.part) return fail();
              objects.set(object, upload.part);
              uploads.delete(id);
              return xml(
                `<CompleteMultipartUploadResult><Bucket>private</Bucket><Key>${object}</Key><ETag>${upload.etag.replaceAll('"', "&quot;")}</ETag></CompleteMultipartUploadResult>`,
              );
            }
            if (req.method === "GET" && url.searchParams.has("uploads")) {
              const prefix = url.searchParams.get("prefix") || "";
              return xml(
                `<ListMultipartUploadsResult><Bucket>private</Bucket><IsTruncated>false</IsTruncated>${[
                  ...uploads.entries(),
                ]
                  .filter(([, u]) => u.key.startsWith(prefix))
                  .map(
                    ([id, u]) =>
                      `<Upload><Key>${u.key}</Key><UploadId>${id}</UploadId></Upload>`,
                  )
                  .join("")}</ListMultipartUploadsResult>`,
              );
            }
            if (req.method === "DELETE" && url.searchParams.has("uploadId")) {
              if (!uploads.delete(url.searchParams.get("uploadId")))
                return fail();
              abortCount++;
              res.writeHead(204);
              res.end();
              return;
            }
            if (req.method === "DELETE") {
              objects.delete(object);
              res.writeHead(204);
              res.end();
              return;
            }
            if (req.method === "HEAD") {
              if (!objects.has(object)) {
                res.writeHead(404);
                res.end();
                return;
              }
              res.writeHead(200, {
                "Content-Length": String(objects.get(object).length),
              });
              res.end();
              return;
            }
            if (req.method === "GET") {
              const data = objects.get(object);
              if (!data) return fail("NoSuchKey");
              let start = 0,
                end = data.length - 1;
              const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
              if (match) {
                start = Number(match[1]);
                end = match[2] ? Number(match[2]) : end;
              }
              const result = data.subarray(start, end + 1);
              res.writeHead(match ? 206 : 200, {
                "Content-Length": String(result.length),
                "Content-Type": "application/octet-stream",
                ...(match
                  ? { "Content-Range": `bytes ${start}-${end}/${data.length}` }
                  : {}),
              });
              res.end(result);
              return;
            }
            xml("<Error><Code>InvalidRequest</Code></Error>", 400);
          } catch {
            xml("<Error><Code>FixtureAssertionFailed</Code></Error>", 500);
          }
        },
      );
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const env = {
        ...process.env,
        MEDIA_STORAGE_DRIVER: "s3",
        MEDIA_S3_ENDPOINT: `https://127.0.0.1:${server.address().port}`,
        MEDIA_S3_REGION: "auto",
        MEDIA_S3_BUCKET: "private",
        MEDIA_S3_ACCESS_KEY_ID: access,
        MEDIA_S3_SECRET_ACCESS_KEY: secret,
        NODE_EXTRA_CA_CERTS: join(tmp, "cert.pem"),
        S3_TEST_KEY: key,
      };
      const script = `import assert from 'node:assert/strict';import {videoStorage} from './lib/video/storage.ts';import {client} from './lib/db/drizzle.ts';
   const s=videoStorage(),key=process.env.S3_TEST_KEY,bytes=Buffer.from('synthetic private quarantine fixture');const id=await s.initiate(key);const authorization=await s.authorize(key,id,bytes.length,900);const url=new URL(authorization);assert.equal(url.pathname,'/private/'+key);assert.equal(url.searchParams.get('partNumber'),'1');
   const put=await fetch(authorization,{method:'PUT',headers:{'Content-Length':String(bytes.length)},body:bytes});assert.equal(put.status,200);
   await assert.rejects(s.complete(key,id,bytes.length+1));assert.equal(await s.complete(key,id,bytes.length),bytes.length);
   assert.equal((await fetch(authorization,{method:'PUT',headers:{'Content-Length':String(bytes.length)},body:bytes})).status,404);
   const range=await s.read(key,2,8);let out=Buffer.alloc(0);for await(const part of range)out=Buffer.concat([out,part]);assert.deepEqual(out,bytes.subarray(2,9));
   assert.equal(await s.complete(key,id,bytes.length),bytes.length,'Crash recovery can verify an already completed key');
   await s.delete(key);assert.equal(await s.head(key),null);
   const abandoned=await s.initiate(key);assert.ok(abandoned);await s.abort(key,null); // recover unknown multipart ID using exact-key listing
   console.log('private multipart protocol verified');await client.end();`;
      const { stdout } = await exec(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          script,
        ],
        { env, timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      assert.match(stdout, /protocol verified/);
      assert.equal(signedParts, 1);
      assert.equal(abortCount, 1);
      assert.equal(objects.size, 0);
      assert.equal(uploads.size, 0);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(tmp, { recursive: true, force: true });
    }
  },
);
