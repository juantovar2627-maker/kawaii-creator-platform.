"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  ArrowUpRight,
  Check,
  Flag,
  MoreHorizontal,
  Plus,
  ShieldBan,
  Star,
} from "lucide-react";
import type { Creator } from "@/lib/demo/community";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDemo } from "./demo-provider";
import { ArtworkPanel, CreatorAvatar } from "./primitives";

export function FollowButton({
  creator,
  compact = false,
}: {
  creator: Creator;
  compact?: boolean;
}) {
  const { state, toggle, notify, ready } = useDemo();
  const followed = state.following.includes(creator.id);
  const blocked = state.blocked.includes(creator.id);
  return (
    <button
      className={`mimi-button ${followed ? "secondary" : "primary"} ${compact ? "small" : ""}`}
      aria-pressed={followed}
      disabled={!ready || blocked}
      onClick={() => {
        toggle("following", creator.id);
        notify(
          followed
            ? "Removed from your demo following list."
            : `Following ${creator.name} in this browser’s demo.`,
        );
      }}
    >
      {followed ? (
        <Check size={15} aria-hidden="true" />
      ) : (
        <Plus size={15} aria-hidden="true" />
      )}
      {followed ? "Following" : "Follow"}
    </button>
  );
}

export function SafetyMenu({
  creator,
  postId,
}: {
  creator: Creator;
  postId?: string;
}) {
  const { state, toggle, openReport, notify } = useDemo();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reportRequested = useRef(false);
  const blocked = state.blocked.includes(creator.id);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        ref={triggerRef}
        className="icon-button safety-trigger"
        aria-label={`More options for ${postId ? "post by " : ""}${creator.name}`}
      >
        <MoreHorizontal size={19} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (reportRequested.current) {
            event.preventDefault();
            reportRequested.current = false;
            // Open only after the menu's focus scope has closed. Overlapping
            // menu/dialog scopes can otherwise steal focus on a quick reopen.
            openReport(
              postId ? `post ${postId}` : `@${creator.username}`,
              triggerRef.current,
            );
          }
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            reportRequested.current = true;
          }}
        >
          <Flag size={15} />
          Report {postId ? "post" : "creator"} (demo)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            toggle("blocked", creator.id);
            notify(
              blocked
                ? `${creator.name} is unblocked in this browser.`
                : `${creator.name} is hidden in this browser’s demo.`,
            );
          }}
        >
          <ShieldBan size={15} />
          {blocked ? "Unblock" : "Block"} creator (demo)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CreatorCard({
  creator,
  featured = false,
}: {
  creator: Creator;
  featured?: boolean;
}) {
  return (
    <article className="creator-card">
      <Link
        href={`/creators/${creator.username}`}
        className="creator-cover-link"
        aria-label={`Visit ${creator.name}'s demo profile`}
      >
        <ArtworkPanel
          art={creator.art}
          label={`${creator.name}'s illustrated creative world`}
        />
        {featured && (
          <span className="featured-label">
            <Star size={10} fill="currentColor" aria-hidden="true" /> Featured
          </span>
        )}
      </Link>
      <div className="creator-card-body">
        <div className="creator-card-top">
          <Link
            href={`/creators/${creator.username}`}
            aria-label={`${creator.name} profile`}
          >
            <CreatorAvatar creator={creator} size="lg" />
          </Link>
          <SafetyMenu creator={creator} />
        </div>
        <Link
          href={`/creators/${creator.username}`}
          className="creator-name-link"
        >
          <h3>
            {creator.name}
            <ArrowUpRight size={16} aria-hidden="true" />
          </h3>
          <span>@{creator.username}</span>
        </Link>
        <p className="creator-tagline">{creator.tagline}</p>
        <div className="creator-card-bottom">
          <span className="category-tag">{creator.category}</span>
          <FollowButton creator={creator} compact />
        </div>
      </div>
    </article>
  );
}
