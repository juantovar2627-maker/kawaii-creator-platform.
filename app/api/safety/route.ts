import { NextRequest } from "next/server";
import {
  checkOrigin,
  input,
  privateJson,
  rateLimit,
  safely,
  signedIn,
  HttpError,
} from "@/lib/moderation/http";
import { safetyInput } from "@/lib/moderation/validation";
import { getOwnSafety, mutateSafety } from "@/lib/moderation/safety";
export async function GET(request: NextRequest) {
  return safely(async () => {
    const user = await signedIn();
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new HttpError(400, "Invalid page.");
    return privateJson(await getOwnSafety(user.id, page));
  });
}
export async function POST(request: NextRequest) {
  return safely(async () => {
    checkOrigin(request);
    const user = await signedIn();
    // Charge malformed attempts too; then apply tighter action-specific limits.
    await rateLimit(user.id, "safety", 30, 60);
    const data = await input(request, safetyInput);
    if (data.action === "report") await rateLimit(user.id, "reports", 5, 3600);
    if (data.action === "appeal") await rateLimit(user.id, "appeals", 3, 3600);
    return privateJson(
      await mutateSafety(user.id, data),
      data.action === "unblock" ? 200 : 201,
    );
  });
}
