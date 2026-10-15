import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  localDevelopment,
  localObjectPath,
  s3Context,
  storage,
} from "@/lib/media/storage";
import { HttpError } from "@/lib/moderation/http";
export const VIDEO_MAX = 100 * 1024 * 1024;
export const VIDEO_RESERVATION_BYTES = 200 * 1024 * 1024;
export const OWNER_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const safeKey = (key: string) => {
  if (!/^[a-f0-9]{64}\.(bin|mp4|webp)$/.test(key))
    throw new Error("Invalid internal object key");
  return key;
};
export function videoStorage() {
  const base = storage();
  const local = base.driver === "local";
  const remote = local ? null : s3Context();
  return {
    driver: base.driver,
    async initiate(key: string) {
      safeKey(key);
      if (local) return null;
      const r = await remote!.client.send(
        new CreateMultipartUploadCommand({
          Bucket: remote!.bucket,
          Key: key,
          ContentType: "application/octet-stream",
          CacheControl: "private, no-store",
        }),
      );
      if (!r.UploadId) throw new Error("Missing upload authorization");
      return r.UploadId;
    },
    async authorize(
      key: string,
      uploadId: string | null,
      expectedBytes: number,
      expiresIn: number,
    ) {
      if (local)
        throw new Error(
          "Local upload authorization uses the application development route",
        );
      if (!uploadId) throw new Error("Missing multipart identifier");
      return getSignedUrl(
        remote!.client,
        new UploadPartCommand({
          Bucket: remote!.bucket,
          Key: safeKey(key),
          UploadId: uploadId,
          PartNumber: 1,
          ContentLength: expectedBytes,
        }),
        { expiresIn, signableHeaders: new Set(["content-length"]) },
      );
    },
    async head(key: string): Promise<number | null> {
      safeKey(key);
      try {
        if (local) return (await stat(localObjectPath(key))).size;
        const r = await remote!.client.send(
          new HeadObjectCommand({ Bucket: remote!.bucket, Key: key }),
        );
        return r.ContentLength ?? null;
      } catch (e) {
        const error = e as {
          code?: string;
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (
          error.code === "ENOENT" ||
          error.name === "NotFound" ||
          error.$metadata?.httpStatusCode === 404
        )
          return null;
        throw e;
      }
    },
    async complete(
      key: string,
      uploadId: string | null,
      expectedBytes: number,
    ) {
      safeKey(key);
      if (local) {
        const actual = await this.head(key);
        if (actual !== expectedBytes || actual > VIDEO_MAX)
          throw new HttpError(
            400,
            "Uploaded video size does not match the reservation.",
          );
        return actual;
      }
      // After a crash between object completion and database commit, the final
      // key is immutable to the browser and can be verified and queued again.
      const existing = await this.head(key);
      if (existing !== null) {
        if (existing !== expectedBytes || existing > VIDEO_MAX)
          throw new HttpError(400, "Uploaded video exceeds its reserved size.");
        return existing;
      }
      if (!uploadId)
        throw new HttpError(409, "Upload authorization unavailable.");
      const parts = await remote!.client.send(
        new ListPartsCommand({
          Bucket: remote!.bucket,
          Key: key,
          UploadId: uploadId,
          MaxParts: 2,
        }),
      );
      if (
        parts.IsTruncated ||
        parts.Parts?.length !== 1 ||
        parts.Parts[0].PartNumber !== 1 ||
        parts.Parts[0].Size !== expectedBytes ||
        expectedBytes > VIDEO_MAX ||
        !parts.Parts[0].ETag
      )
        throw new HttpError(
          400,
          "Upload one complete video within the reserved size.",
        );
      await remote!.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: remote!.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: parts.Parts[0].ETag }],
          },
        }),
      );
      const actual = await this.head(key);
      if (actual !== expectedBytes)
        throw new HttpError(400, "Completed upload size mismatch.");
      return actual;
    },
    async abort(key: string, uploadId: string | null) {
      safeKey(key);
      if (local) return;
      const ids = new Set<string>(uploadId ? [uploadId] : []);
      // Exact-key listing also recovers a crash just after multipart creation,
      // before its provider-generated upload ID reached PostgreSQL.
      const list = await remote!.client.send(
        new ListMultipartUploadsCommand({
          Bucket: remote!.bucket,
          Prefix: key,
          MaxUploads: 100,
        }),
      );
      if (list.IsTruncated)
        throw new Error("Multipart cleanup needs operator reconciliation");
      for (const u of list.Uploads ?? [])
        if (u.Key === key && u.UploadId) ids.add(u.UploadId);
      for (const id of ids)
        try {
          await remote!.client.send(
            new AbortMultipartUploadCommand({
              Bucket: remote!.bucket,
              Key: key,
              UploadId: id,
            }),
          );
        } catch (e) {
          if ((e as { name?: string }).name !== "NoSuchUpload") throw e;
        }
    },
    async read(key: string, start?: number, end?: number) {
      safeKey(key);
      if (local) {
        const path = localObjectPath(key);
        if (!(await stat(path)).isFile())
          throw new Error("Private video object unavailable");
        return createReadStream(path, { start, end });
      }
      const result = await remote!.client.send(
        new GetObjectCommand({
          Bucket: remote!.bucket,
          Key: key,
          ...(start === undefined
            ? {}
            : { Range: `bytes=${start}-${end ?? ""}` }),
        }),
      );
      if (!result.Body) throw new Error("Missing private object");
      return result.Body as Readable;
    },
    async download(
      key: string,
      destination: string,
      max: number,
      signal: AbortSignal,
    ) {
      const source = await this.read(key);
      let bytes = 0;
      await pipeline(
        source,
        new Transform({
          transform(chunk, _encoding, done) {
            bytes += chunk.length;
            done(
              bytes > max ? new Error("Video download exceeded bounds") : null,
              chunk,
            );
          },
        }),
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      return bytes;
    },
    async putFile(
      key: string,
      path: string,
      contentType: "video/mp4" | "image/webp",
    ) {
      safeKey(key);
      const size = (await stat(path)).size;
      if (size <= 0 || size > VIDEO_MAX)
        throw new Error("Invalid processed file size");
      if (local) {
        const target = localObjectPath(key);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await pipeline(
          createReadStream(path),
          createWriteStream(target, { mode: 0o600 }),
        );
      } else
        await remote!.client.send(
          new PutObjectCommand({
            Bucket: remote!.bucket,
            Key: key,
            Body: createReadStream(path),
            ContentLength: size,
            ContentType: contentType,
            CacheControl: "private, no-store",
          }),
        );
    },
    async localWrite(
      key: string,
      source: ReadableStream<Uint8Array>,
      expectedBytes: number,
      signal: AbortSignal,
    ) {
      if (!local || !localDevelopment())
        throw new HttpError(404, "Local video upload unavailable.");
      const path = localObjectPath(safeKey(key));
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      let bytes = 0;
      await pipeline(
        Readable.fromWeb(source as never),
        new Transform({
          transform(chunk, _enc, done) {
            bytes += chunk.length;
            done(
              bytes > expectedBytes || bytes > VIDEO_MAX
                ? new HttpError(413, "Video exceeds its reserved size.")
                : null,
              chunk,
            );
          },
        }),
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      if (bytes !== expectedBytes)
        throw new HttpError(400, "Incomplete video upload.");
      return bytes;
    },
    delete: base.delete,
  };
}
