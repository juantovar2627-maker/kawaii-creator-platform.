// Public, finite presets: no uploads, custom CSS, or arbitrary embedded content.
export const creatorCategories = [
  "Fashion & style",
  "Cosplay",
  "Art & illustration",
  "Lifestyle",
  "Gaming",
] as const;
export const themes = {
  pink: { label: "Rose milk", color: "#f9dbe4" },
  lavender: { label: "Lavender dream", color: "#e9dff6" },
  peach: { label: "Peach cloud", color: "#ffe3cb" },
  mint: { label: "Mint tea", color: "#dcefe4" },
} as const;
export const avatars = {
  flower: "✿",
  star: "✦",
  bow: "୨୧",
  cloud: "☁",
} as const;
export const banners = {
  blossom: "Blossom",
  daydream: "Daydream",
  sunrise: "Sunrise",
} as const;
export type Theme = keyof typeof themes;
export type Avatar = keyof typeof avatars;
export type Banner = keyof typeof banners;
export type CreatorCategory = (typeof creatorCategories)[number];
export type Visibility = "hidden" | "unlisted" | "listed";

// Explicit public DTO. Never pass a database user, owner ID, or moderation record
// to a public component or endpoint.
export type PublicCreator = {
  username: string;
  displayName: string;
  biography: string;
  theme: Theme;
  avatar: Avatar;
  banner: Banner;
  categories: CreatorCategory[];
  websiteUrl: string;
  instagramUrl: string;
  youtubeUrl: string;
};
export type OwnCreator = PublicCreator & {
  visibility: Visibility;
  moderationStatus: "pending" | "approved" | "suspended";
  createdAt: string;
  updatedAt: string;
};
