"use client";

import { creators } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import { CreatorCard } from "./creator-card";

export function FeaturedCreators() {
  const { state } = useDemo();
  return (
    <div className="creator-grid">
      {creators
        .filter((creator) => !state.blocked.includes(creator.id))
        .slice(0, 3)
        .map((creator) => (
          <CreatorCard key={creator.id} creator={creator} featured />
        ))}
    </div>
  );
}
