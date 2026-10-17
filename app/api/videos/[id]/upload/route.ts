import { uploadGate } from "@/lib/security/upload-gate";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  checkOrigin,
  HttpError,
  privateJson,
  rateLimit,
  safely,
  signedIn,
} from "@/lib/moderation/http";
import { receiveLocalVideo } from "@/lib/video/service";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = uploadGate(request);
  if (gate) return gate;
  return safely(async () => {
    checkOrigin(request);
    const user = await signedIn();
    await rateLimit(user.id, "video_binary", 10, 3600);
    const { id } = await params;
    const token = request.headers.get("x-upload-token") || "";
    if (
      !z.string().uuid().safeParse(id).success ||
      !/^[a-f0-9]{64}$/.test(token)
    )
      throw new HttpError(400, "Invalid video upload authorization.");
    return privateJson(await receiveLocalVideo(user.id, id, token, request));
  });
}
