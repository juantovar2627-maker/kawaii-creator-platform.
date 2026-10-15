import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { creatorProfiles as profiles, users } from "@/lib/db/schema";
import type { OwnCreator, PublicCreator } from "./presets";

export const publicCreatorColumns = {
  username: profiles.username,
  displayName: profiles.displayName,
  biography: profiles.biography,
  theme: profiles.theme,
  avatar: profiles.avatar,
  banner: profiles.banner,
  categories: profiles.categories,
  websiteUrl: profiles.websiteUrl,
  instagramUrl: profiles.instagramUrl,
  youtubeUrl: profiles.youtubeUrl,
};
const accessible = and(
  ne(profiles.visibility, "hidden"),
  ne(profiles.moderationStatus, "suspended"),
  isNull(users.deletedAt),
);

export async function getPublicCreator(
  username: string,
): Promise<PublicCreator | null> {
  // Reject malformed paths without querying. Case-insensitive URLs are supported.
  if (!/^[a-z][a-z0-9_]{2,29}$/i.test(username)) return null;
  const [profile] = await db
    .select(publicCreatorColumns)
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(and(eq(profiles.username, username.toLowerCase()), accessible))
    .limit(1);
  return profile ?? null;
}

export async function getDiscoverableCreators(): Promise<PublicCreator[]> {
  return db
    .select(publicCreatorColumns)
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(
      and(
        accessible,
        eq(profiles.visibility, "listed"),
        eq(profiles.moderationStatus, "approved"),
      ),
    )
    .orderBy(asc(profiles.displayName), asc(profiles.username))
    .limit(100);
}

export async function getOwnCreator(
  userId: number,
): Promise<OwnCreator | null> {
  const [profile] = await db
    .select({
      ...publicCreatorColumns,
      visibility: profiles.visibility,
      moderationStatus: profiles.moderationStatus,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return profile
    ? {
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      }
    : null;
}
