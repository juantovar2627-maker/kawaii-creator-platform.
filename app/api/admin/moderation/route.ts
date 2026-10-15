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
import { adminInput, queueInput } from "@/lib/moderation/validation";
import { getModerationQueue, mutateModeration } from "@/lib/moderation/admin";
async function authorize() {
  const user = await getUser();
  if (!user || !(await getStaffForUser(user.id)))
    throw new HttpError(403, "Staff authorization required.");
  return user;
}
export async function GET(request: NextRequest) {
  return safely(async () => {
    await authorize();
    const query = queueInput.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!query.success) throw new HttpError(400, "Invalid queue filters.");
    return privateJson(await getModerationQueue(query.data));
  });
}
export async function POST(request: NextRequest) {
  return safely(async () => {
    checkOrigin(request);
    const user = await authorize();
    await rateLimit(user.id, "moderation", 60, 60);
    return privateJson(
      await mutateModeration(user.id, await input(request, adminInput)),
    );
  });
}
