import { NextRequest } from "next/server";
import { getUser } from "@/lib/db/queries";
import {
  checkOrigin,
  HttpError,
  input,
  privateJson,
  rateLimit,
  safely,
  signedIn,
} from "@/lib/moderation/http";
import { socialInput, socialQuery } from "@/lib/social/validation";
import {
  creatorSocial,
  followingCreators,
  getComments,
  getFeed,
  ownActivity,
  ownPosts,
  publicPost,
} from "@/lib/social/queries";
import { mutateSocial } from "@/lib/social/mutations";
export async function GET(request: NextRequest) {
  return safely(async () => {
    const result = socialQuery.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!result.success) throw new HttpError(400, "Invalid social query.");
    const q = result.data;
    const user = await getUser();
    const viewer = user?.id ?? null;
    if (
      ["following", "workspace", "activity"].includes(q.view) ||
      ["saved", "following"].includes(q.scope)
    ) {
      if (!user) throw new HttpError(401, "Sign in to view your social space.");
    }
    if (q.view === "creator") {
      if (!q.username) throw new HttpError(400, "Choose a creator.");
      return privateJson(await creatorSocial(q.username, viewer));
    }
    if (q.view === "post") {
      if (!q.id) throw new HttpError(400, "Choose a post.");
      return privateJson(await publicPost(q.id, viewer));
    }
    if (q.view === "comments") {
      if (!q.id) throw new HttpError(400, "Choose a post.");
      return privateJson(await getComments(q.id, viewer, q.page));
    }
    if (q.view === "following")
      return privateJson(await followingCreators(user!.id, q.page));
    if (q.view === "workspace")
      return privateJson(await ownPosts(user!.id, q.page));
    if (q.view === "activity")
      return privateJson(await ownActivity(user!.id, q.page));
    return privateJson(await getFeed(viewer, q.scope, q.page, q.username));
  });
}
export async function POST(request: NextRequest) {
  return safely(async () => {
    checkOrigin(request);
    const user = await signedIn();
    await rateLimit(user.id, "social", 40, 60);
    const data = await input(request, socialInput);
    if (data.action === "create_post")
      await rateLimit(user.id, "postdrafts", 10, 3600);
    if (["comment", "edit_comment"].includes(data.action))
      await rateLimit(user.id, "comments", 10, 300);
    if (data.action === "report")
      await rateLimit(user.id, "socialreports", 5, 3600);
    if (data.action === "appeal")
      await rateLimit(user.id, "socialappeals", 3, 3600);
    return privateJson(await mutateSocial(user.id, data));
  });
}
