import "server-only";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { HttpError } from "@/lib/moderation/http";
import { localDevelopment } from "./storage";
export const MAX_BYTES = 10 * 1024 * 1024;
sharp.cache(false);
sharp.concurrency(1);
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export async function processPhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new HttpError(413, "Photos must be at most 10 MB.");
  const jpeg =
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
  const png =
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes
      .subarray(-12)
      .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  const webp =
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) === bytes.length - 8;
  if (!jpeg && !png && !webp)
    throw new HttpError(
      400,
      "Upload a complete JPEG, PNG, or WebP photo. SVG and other formats are not supported.",
    );
  // Some decoders expose only the first APNG frame. Reject the animation
  // control chunk explicitly rather than relying solely on metadata.pages.
  if (png) {
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const length = bytes.readUInt32BE(offset);
      if (offset + 12 + length > bytes.length)
        throw new HttpError(400, "Incomplete PNG chunk.");
      if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL")
        throw new HttpError(400, "Animated photos are not supported.");
      offset += length + 12;
    }
  }
  try {
    const options = {
      limitInputPixels: 20_000_000,
      failOn: "warning" as const,
    };
    const meta = await sharp(bytes, options).metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width > 8000 ||
      meta.height > 8000 ||
      (meta.pages ?? 1) > 1 ||
      !["jpeg", "png", "webp"].includes(meta.format || "")
    )
      throw new Error("Dimensions or frames");
    // Auto-orient, strip all metadata (Sharp default), decode and re-encode.
    const { data: display, info } = await sharp(bytes, options)
      .timeout({ seconds: 10 })
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(display)
      .timeout({ seconds: 5 })
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    if (display.length + thumbnail.length > MAX_BYTES)
      throw new Error("Output too large");
    return {
      display,
      thumbnail,
      width: info.width,
      height: info.height,
      sha256: digest(display),
    };
  } catch {
    throw new HttpError(
      400,
      "This photo could not be decoded safely. Use a still image up to 8000 pixels per side and 20 megapixels.",
    );
  }
}

export async function scanPhoto(
  display: Buffer,
  thumbnail: Buffer,
  sha256: string,
): Promise<{
  status: "passed" | "rejected" | "unavailable" | "development_manual";
  policy: string;
}> {
  if (
    localDevelopment() &&
    process.env.MEDIA_SCAN_MODE === "development-manual"
  )
    return {
      status: "development_manual",
      policy: "Unscanned development fixture; human review required",
    };
  // A trusted scanner must assess BOTH malware and the configured non-explicit
  // content policy. Matching the digest binds its decision to these exact bytes.
  try {
    const url = new URL(process.env.MEDIA_SCANNER_URL || "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !process.env.MEDIA_SCANNER_TOKEN
    )
      throw new Error("Scanner not configured");
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MEDIA_SCANNER_TOKEN}`,
      },
      body: JSON.stringify({
        sha256,
        contentType: "image/webp",
        image: display.toString("base64"),
        thumbnail: thumbnail.toString("base64"),
        policy: "mimi-non-explicit-v1",
      }),
    });
    const reader = response.body?.getReader();
    if (!response.ok || !reader) throw new Error("Scanner unavailable");
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("Scanner response too large");
      }
      parts.push(part.value);
    }
    const result = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (
      result.sha256 !== sha256 ||
      result.policy !== "mimi-non-explicit-v1" ||
      result.malware !== "pass" ||
      result.content !== "pass"
    )
      return { status: "rejected", policy: "mimi-non-explicit-v1" };
    return { status: "passed", policy: result.policy };
  } catch {
    return {
      status: "unavailable",
      policy: "Required production scanner unavailable; publication blocked",
    };
  }
}
