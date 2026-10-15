import { NextRequest } from "next/server";
import {
  checkOrigin,
  input,
  privateJson,
  rateLimit,
  safely,
  signedIn,
} from "@/lib/moderation/http";
import { changePhotos, mediaInput } from "@/lib/media/service";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return safely(async () => {
    checkOrigin(request);
    const user = await signedIn();
    await rateLimit(user.id, "media", 30, 60);
    const data = await input(request, mediaInput);
    if (data.action === "reserve")
      await rateLimit(user.id, "photo_uploads", 20, 3600);
    return privateJson(await changePhotos(user.id, data));
  });
}
