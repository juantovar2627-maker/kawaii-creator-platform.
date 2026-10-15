import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/drizzle";
import { getUser } from "@/lib/db/queries";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { HttpError, safely } from "@/lib/moderation/http";
import { postVisible } from "@/lib/social/access";
import { videoStorage } from "@/lib/video/storage";
import { videoRange } from "@/lib/video/range";
export const runtime = "nodejs";
async function deliver(
  request: NextRequest,
  params: Promise<{ id: string }>,
  head = false,
) {
  return safely(async () => {
    const { id } = await params;
    const variant = request.nextUrl.searchParams.get("variant") || "playback";
    if (
      !z.string().uuid().safeParse(id).success ||
      !["playback", "poster"].includes(variant)
    )
      throw new HttpError(404, "Video unavailable.");
    const viewer = await getUser(),
      staff = viewer ? await getStaffForUser(viewer.id) : null;
    const [asset] = await db.execute<{
      playback_key: string;
      poster_key: string;
      playback_bytes: number;
      poster_bytes: number;
      storage_driver: string;
    }>(
      sql`select v.playback_key,v.poster_key,v.playback_bytes,v.poster_bytes,v.storage_driver from video_assets v join video_jobs j on j.asset_id=v.id join social_posts p on p.id=v.post_id join creator_profiles cp on cp.id=p.profile_id join users u on u.id=cp.user_id where v.id=${id} and v.state='ready' and j.state='succeeded' and (${staff ? sql`true` : sql`false`} or (v.owner_id=${viewer?.id ?? null} and v.deleted_at is null and p.deleted_at is null) or (v.deleted_at is null and v.moderation='approved' and v.approved_revision=p.revision and ${postVisible(viewer?.id ?? null)}))`,
    );
    if (!asset) throw new HttpError(404, "Video unavailable.");
    const size =
        variant === "poster" ? asset.poster_bytes : asset.playback_bytes,
      range = videoRange(request.headers.get("range"), size);
    const headers: Record<string, string> = {
      "Content-Type": variant === "poster" ? "image/webp" : "video/mp4",
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Content-Disposition":
        variant === "poster"
          ? 'inline; filename="mimi-poster.webp"'
          : 'inline; filename="mimi-video.mp4"',
    };
    if (!range)
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    headers["Content-Length"] = String(range.end - range.start + 1);
    if (range.partial)
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    const store = videoStorage();
    if (store.driver !== asset.storage_driver)
      throw new HttpError(503, "Private video storage is unavailable.");
    if (head)
      return new NextResponse(null, {
        status: range.partial ? 206 : 200,
        headers,
      });
    let stream: Readable;
    try {
      stream = await store.read(
        variant === "poster" ? asset.poster_key : asset.playback_key,
        range.start,
        range.end,
      );
    } catch {
      throw new HttpError(404, "Video unavailable.");
    }
    request.signal.addEventListener("abort", () => stream.destroy(), {
      once: true,
    });
    return new NextResponse(
      Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      { status: range.partial ? 206 : 200, headers },
    );
  });
}
export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return deliver(request, params);
}
export function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return deliver(request, params, true);
}
