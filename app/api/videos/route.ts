import { NextRequest } from "next/server";
import {
  checkOrigin,
  input,
  privateJson,
  rateLimit,
  safely,
  signedIn,
} from "@/lib/moderation/http";
import { mutateVideo, videoInput } from "@/lib/video/service";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return safely(async () => {
    checkOrigin(request);
    const user = await signedIn();
    await rateLimit(user.id, "video", 30, 60);
    const data = await input(request, videoInput);
    if (data.action === "reserve")
      await rateLimit(user.id, "video_reservations", 5, 3600);
    return privateJson(await mutateVideo(user.id, data));
  });
}
