import "server-only";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { localDevelopment } from "@/lib/media/storage";
export async function scanVideo(
  path: string,
  bytes: number,
  sha256: string,
  audio: boolean,
  signal: AbortSignal,
): Promise<"passed" | "rejected" | "unavailable" | "development_manual"> {
  if (
    localDevelopment() &&
    process.env.MEDIA_SCAN_MODE === "development-manual"
  )
    return "development_manual";
  try {
    const url = new URL(process.env.VIDEO_SCANNER_URL || "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !process.env.VIDEO_SCANNER_TOKEN
    )
      return "unavailable";
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes),
        Authorization: `Bearer ${process.env.VIDEO_SCANNER_TOKEN}`,
        "X-Content-SHA256": sha256,
        "X-Mimi-Policy": "mimi-video-non-explicit-v1",
        "X-Has-Audio": String(audio),
      },
      body: Readable.toWeb(
        createReadStream(path),
      ) as ReadableStream<Uint8Array>,
      duplex: "half",
    } as RequestInit & { duplex: string });
    if (!response.ok || !response.body) return "unavailable";
    const reader = response.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 8192) {
        await reader.cancel();
        return "unavailable";
      }
      chunks.push(part.value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return result.sha256 === sha256 &&
      result.policy === "mimi-video-non-explicit-v1" &&
      result.malware === "pass" &&
      result.content === "pass" &&
      result.frames === "all" &&
      result.audio === (audio ? "all" : "none") &&
      result.complete === true
      ? "passed"
      : "rejected";
  } catch {
    return "unavailable";
  }
}
