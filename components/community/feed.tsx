"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Heart, Sparkles } from "lucide-react";
import { creators, visiblePosts } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import { CreatorAvatar, EmptyState } from "./primitives";
import { FollowButton } from "./creator-card";
import { PostCard } from "./post-card";

export function Feed({
  mode = "all",
  creatorId,
  limit,
}: {
  mode?: "all" | "following" | "saved";
  creatorId?: string;
  limit?: number;
}) {
  const { state } = useDemo();
  const [type, setType] = useState<"all" | "photo" | "video">("all");
  const filtered = visiblePosts({
    blocked: state.blocked,
    following: mode === "following" ? state.following : undefined,
    saved: mode === "saved" ? state.saved : undefined,
    creatorId,
    type,
  });
  const displayed = limit ? filtered.slice(0, limit) : filtered;
  return (
    <div className="feed-content">
      <div className="feed-toolbar">
        <div className="feed-tabs" aria-label="Post types">
          {(["all", "photo", "video"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setType(value)}
              aria-pressed={type === value}
              className={type === value ? "active" : ""}
            >
              {value === "all"
                ? "All posts"
                : value === "photo"
                  ? "Photos"
                  : "Videos"}
            </button>
          ))}
        </div>
        <span className="feed-order">
          A little inspiration <Sparkles size={13} aria-hidden="true" />
        </span>
      </div>
      {displayed.length ? (
        <div className={limit ? "home-post-grid" : "post-list"}>
          {displayed.map((post) => (
            <PostCard key={post.id} post={post} compact={Boolean(limit)} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            mode === "saved"
              ? "Keep a little inspiration for later"
              : mode === "following"
                ? "Your people are waiting to be found"
                : "A little room for something new"
          }
        >
          {mode === "saved"
            ? "Tap the bookmark on a demo post to save it in this browser."
            : mode === "following"
              ? "Follow a demo creator and their posts will appear here. It’s your very own little inspiration feed."
              : "No posts match this view. Try another post type or discover someone new."}
        </EmptyState>
      )}
    </div>
  );
}

export function FeedAside() {
  const { state } = useDemo();
  return (
    <aside className="feed-aside">
      <div className="aside-card">
        <p className="eyebrow">A LITTLE DISCOVERY</p>
        <h3>Your next favorite creators</h3>
        {creators
          .filter((creator) => !state.blocked.includes(creator.id))
          .slice(0, 3)
          .map((creator) => (
            <div className="suggested-creator" key={creator.id}>
              <Link
                href={`/creators/${creator.username}`}
                className="suggested-person"
              >
                <CreatorAvatar creator={creator} size="sm" />
                <span>
                  <strong>{creator.name}</strong>
                  <small>{creator.category}</small>
                </span>
              </Link>
              <FollowButton creator={creator} compact />
            </div>
          ))}
        <Link className="text-link" href="/discover">
          Explore the community
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <div className="kindness-card">
        <Heart size={25} strokeWidth={1.5} aria-hidden="true" />
        <h3>Come as you are.</h3>
        <p>
          A good community makes room for self-expression. Share kindly, respect
          boundaries, and let people bloom.
        </p>
        <Link href="/community-guidelines">
          Our community promise
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
