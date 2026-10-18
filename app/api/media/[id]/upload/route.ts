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
import { receivePhoto } from "@/lib/media/service";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = uploadGate(request);
  if (gate) return gate;
  return safely(async () => {
    checkOrigin(request);
    const user = await signedIn();
    await rateLimit(user.id, "media_binary", 30, 3600);
    const { id } = await params;
    const token = request.headers.get("x-upload-token") || "";
    if (
      !z.string().uuid().safeParse(id).success ||
      !/^[a-f0-9]{64}$/.test(token)
    )
      throw new HttpError(400, "Invalid upload authorization.");
    return privateJson(await receivePhoto(user.id, id, token, request));
  });
}
