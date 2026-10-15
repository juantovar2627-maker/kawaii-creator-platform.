import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { getUser } from "@/lib/db/queries";
import { getStaffForUser } from "@/lib/moderation/permissions";
import { HttpError, safely } from "@/lib/moderation/http";
import { postVisible } from "@/lib/social/access";
import { storage } from "@/lib/media/storage";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return safely(async () => {
    const { id } = await params;
    const variant = request.nextUrl.searchParams.get("variant") || "thumb";
    if (
      !z.string().uuid().safeParse(id).success ||
      !["thumb", "display"].includes(variant)
    )
      throw new HttpError(404, "Photo unavailable.");
    const viewer = await getUser();
    const staff = viewer ? await getStaffForUser(viewer.id) : null;
    const [asset] = await db.execute<{
      display_key: string;
      thumbnail_key: string;
      storage_driver: string;
    }>(sql`select m.display_key,m.thumbnail_key,m.storage_driver from media_assets m join social_posts p on p.id=m.post_id join creator_profiles cp on cp.id=p.profile_id join users u on u.id=cp.user_id where m.id=${id} and m.state='ready' and (
      ${staff ? sql`true` : sql`false`} or (m.owner_id=${viewer?.id ?? null} and m.deleted_at is null and p.deleted_at is null) or (m.deleted_at is null and m.moderation='approved' and m.approved_revision=p.revision and ${postVisible(viewer?.id ?? null)})
    )`);
    if (!asset) throw new HttpError(404, "Photo unavailable.");
    const store = storage();
    if (store.driver !== asset.storage_driver)
      throw new HttpError(503, "The photo storage adapter is unavailable.");
    let bytes: Buffer;
    try {
      bytes = await store.get(
        variant === "display" ? asset.display_key : asset.thumbnail_key,
      );
    } catch {
      throw new HttpError(404, "Photo unavailable.");
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
        "Content-Disposition": 'inline; filename="mimi-photo.webp"',
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
