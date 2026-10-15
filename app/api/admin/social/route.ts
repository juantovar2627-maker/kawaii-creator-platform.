import { NextRequest } from "next/server";
import { getUser } from "@/lib/db/queries";
import { getStaffForUser } from "@/lib/moderation/permissions";
import {
  checkOrigin,
  HttpError,
  input,
  privateJson,
  rateLimit,
  safely,
} from "@/lib/moderation/http";
import { socialAdminInput, socialAdminQuery } from "@/lib/social/validation";
import { getSocialQueue, moderateSocial } from "@/lib/social/moderation";
async function authorize() {
  const user = await getUser();
  if (!user || !(await getStaffForUser(user.id)))
    throw new HttpError(403, "Staff authorization required.");
  return user;
}
export async function GET(request: NextRequest) {
  return safely(async () => {
    await authorize();
    const q = socialAdminQuery.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!q.success) throw new HttpError(400, "Invalid content queue filters.");
    return privateJson(await getSocialQueue(q.data));
  });
}
export async function POST(request: NextRequest) {
  return safely(async () => {
    checkOrigin(request);
    const user = await authorize();
    await rateLimit(user.id, "moderation", 60, 60);
    return privateJson(
      await moderateSocial(user.id, await input(request, socialAdminInput)),
    );
  });
}
