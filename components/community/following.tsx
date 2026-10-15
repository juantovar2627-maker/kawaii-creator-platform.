"use client";

import Link from "next/link";
import { creators } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import { CreatorAvatar } from "./primitives";
import { Feed, FeedAside } from "./feed";

export function Following() {
  const { state } = useDemo();
  const following = creators.filter(
    (creator) =>
      state.following.includes(creator.id) &&
      !state.blocked.includes(creator.id),
  );
  return (
    <>
      {following.length > 0 && (
        <div className="following-creators">
          {following.map((creator) => (
            <Link key={creator.id} href={`/creators/${creator.username}`}>
              <CreatorAvatar creator={creator} size="lg" />
              <span>{creator.name}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="feed-layout">
        <Feed mode="following" />
        <FeedAside />
      </div>
    </>
  );
}
