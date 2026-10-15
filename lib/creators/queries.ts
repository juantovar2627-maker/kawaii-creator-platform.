import "server-only";
import { and, asc, eq, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import {
  accountBlocks as blocks,
  creatorProfiles as profiles,
  users,
} from "@/lib/db/schema";
import { getUser } from "@/lib/db/queries";
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
async function permittedForViewer() {
  const viewer = await getUser();
  return viewer
    ? notExists(
        db
          .select({ one: sql`1` })
          .from(blocks)
          .where(
            or(
              and(
                eq(blocks.blockerId, viewer.id),
                eq(blocks.blockedId, profiles.userId),
              ),
              and(
                eq(blocks.blockedId, viewer.id),
                eq(blocks.blockerId, profiles.userId),
              ),
            ),
          ),
      )
    : undefined;
}

export async function getPublicCreator(
  username: string,
): Promise<PublicCreator | null> {
  // Reject malformed paths without querying. Case-insensitive URLs are supported.
  if (!/^[a-z][a-z0-9_]{2,29}$/i.test(username)) return null;
  const viewerFilter = await permittedForViewer();
  const [profile] = await db
    .select(publicCreatorColumns)
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(
      and(
        eq(profiles.username, username.toLowerCase()),
        accessible,
        viewerFilter,
      ),
    )
    .limit(1);
  return profile ?? null;
}

export async function getDiscoverableCreators(): Promise<PublicCreator[]> {
  const viewerFilter = await permittedForViewer();
  return db
    .select(publicCreatorColumns)
    .from(profiles)
    .innerJoin(users, eq(profiles.userId, users.id))
    .where(
      and(
        accessible,
        eq(profiles.visibility, "listed"),
        eq(profiles.moderationStatus, "approved"),
        eq(profiles.listingRejected, false),
        viewerFilter,
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
      listingRejected: profiles.listingRejected,
      moderationReason: profiles.moderationReason,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!profile) return null;
  const { listingRejected, ...own } = profile;
  return {
    ...own,
    moderationStatus:
      listingRejected && profile.moderationStatus !== "suspended"
        ? "rejected"
        : profile.moderationStatus,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
