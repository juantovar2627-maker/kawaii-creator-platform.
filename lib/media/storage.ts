import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { HttpError } from "@/lib/moderation/http";

export type Storage = {
  driver: "local" | "s3";
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
};
export function localDevelopment() {
  try {
    return (
      process.env.MEDIA_STORAGE_DRIVER === "local" &&
      (!process.env.APP_ENV || process.env.APP_ENV === "development") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.BASE_URL || "").hostname,
      )
    );
  } catch {
    return false;
  }
}
export function storage(): Storage {
  // No client or credential lookup at module initialization/build time.
  const driver = process.env.MEDIA_STORAGE_DRIVER;
  if (driver === "local" && localDevelopment()) {
    const root = process.env.MEDIA_LOCAL_ROOT;
    if (
      !root ||
      !isAbsolute(root) ||
      resolve(root) === process.cwd() ||
      resolve(root).startsWith(process.cwd() + "/")
    )
      throw new HttpError(
        503,
        "Configure MEDIA_LOCAL_ROOT as a private absolute directory outside the repository.",
      );
    const path = (key: string) => {
      if (!/^[a-f0-9]{64}\.(webp|mp4|bin)$/.test(key))
        throw new Error("Invalid internal object key");
      return join(root, key);
    };
    return {
      driver,
      async put(key, bytes) {
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeFile(path(key), bytes, { flag: "wx", mode: 0o600 });
      },
      async get(key) {
        return readFile(path(key));
      },
      async delete(key) {
        try {
          await unlink(path(key));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      },
    };
  }
  if (
    driver === "s3" &&
    process.env.MEDIA_S3_ENDPOINT &&
    process.env.MEDIA_S3_REGION &&
    process.env.MEDIA_S3_BUCKET &&
    process.env.MEDIA_S3_ACCESS_KEY_ID &&
    process.env.MEDIA_S3_SECRET_ACCESS_KEY
  ) {
    const { client, bucket } = s3Context();
    return {
      driver,
      async put(key, bytes) {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: "image/webp",
            CacheControl: "private, no-store",
          }),
        );
      },
      async get(key) {
        const r = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (!r.Body || (r.ContentLength ?? Infinity) > 10485760)
          throw new Error("Invalid storage response");
        const parts: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > 10485760) throw new Error("Storage object too large");
          parts.push(chunk);
        }
        return Buffer.concat(parts);
      },
      async delete(key) {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      },
    };
  }
  throw new HttpError(
    503,
    "Private media storage is unavailable. Configure private S3/R2 storage, or the documented local development adapter. Text posts still work.",
  );
}

export function s3Context() {
  if (
    !process.env.MEDIA_S3_ENDPOINT ||
    !process.env.MEDIA_S3_REGION ||
    !process.env.MEDIA_S3_BUCKET ||
    !process.env.MEDIA_S3_ACCESS_KEY_ID ||
    !process.env.MEDIA_S3_SECRET_ACCESS_KEY
  )
    throw new HttpError(
      503,
      "Private video storage is unavailable. Configure the documented private S3/R2 adapter.",
    );
  let endpoint: URL;
  try {
    endpoint = new URL(process.env.MEDIA_S3_ENDPOINT);
  } catch {
    throw new HttpError(
      503,
      "Configure a valid private storage HTTPS endpoint.",
    );
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new HttpError(503, "Private storage requires an HTTPS endpoint.");
  const bucket = process.env.MEDIA_S3_BUCKET;
  const client = new S3Client({
    endpoint: endpoint.toString(),
    region: process.env.MEDIA_S3_REGION,
    credentials: {
      accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    forcePathStyle: true,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
  });

  return { client, bucket };
}

export function localObjectPath(key: string) {
  if (!localDevelopment() || !/^[a-f0-9]{64}\.(webp|mp4|bin)$/.test(key))
    throw new HttpError(503, "Private local video storage is not configured.");
  storage();
  return join(process.env.MEDIA_LOCAL_ROOT!, key);
}
