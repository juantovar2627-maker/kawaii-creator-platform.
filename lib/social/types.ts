import type { Avatar, Theme } from "@/lib/creators/presets";
export type SocialCreator = {
  username: string;
  displayName: string;
  avatar: Avatar;
  theme: Theme;
};
export type PublicPost = {
  id: number;
  title: string;
  body: string;
  publishedAt: string;
  creator: SocialCreator;
  likes: number;
  comments: number;
  liked: boolean;
  saved: boolean;
  mine: boolean;
};
export type PublicComment = {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  author: SocialCreator | null;
  mine: boolean;
};
export type OwnPost = {
  id: number;
  title: string;
  body: string;
  status: string;
  revision: number;
  moderationReason: string;
  updatedAt: string;
  publishedAt: string | null;
};
export type Page<T> = { items: T[]; page: number; hasMore: boolean };
