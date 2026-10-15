"use client";

import { Check, Heart, Instagram, LockKeyhole, MapPin } from "lucide-react";
import type { Creator } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import {
  ArtworkPanel,
  CreatorAvatar,
  DemoBadge,
  DemoNotice,
} from "./primitives";
import { FollowButton, SafetyMenu } from "./creator-card";
import { Feed } from "./feed";

export function CreatorProfile({ creator }: { creator: Creator }) {
  const { state, toggle } = useDemo();
  if (state.blocked.includes(creator.id))
    return (
      <div className="account-panel">
        <h1 className="text-2xl font-bold mb-4">{creator.name} is blocked</h1>
        <p>
          Their demo content is hidden in this browser. No real account has been
          blocked.
        </p>
        <button
          className="mimi-button secondary"
          onClick={() => toggle("blocked", creator.id)}
        >
          Unblock demo creator
        </button>
      </div>
    );
  return (
    <>
      <div className="profile-banner">
        <ArtworkPanel
          art={creator.art}
          label={`Illustrated banner for ${creator.name}`}
        />
        <DemoBadge>Fictional creator profile</DemoBadge>
      </div>
      <div className="profile-identity">
        <CreatorAvatar creator={creator} size="xl" />
        <div className="profile-actions">
          <FollowButton creator={creator} />
          <SafetyMenu creator={creator} />
        </div>
      </div>
      <div className="profile-main">
        <h1>
          {creator.name}
          <span aria-hidden="true" className="text-[#c390b6] ml-2 text-xl">
            ✧
          </span>
        </h1>
        <p className="profile-handle">
          @{creator.username}
          <span>{creator.pronouns}</span>
        </p>
        <p className="profile-bio">{creator.bio}</p>
        <div className="profile-details">
          <span>
            <MapPin size={13} aria-hidden="true" />
            {creator.location}
          </span>
          <a
            href="https://www.instagram.com/"
            target="_blank"
            rel="noreferrer noopener"
          >
            <Instagram size={13} aria-hidden="true" />
            Instagram · demo link
          </a>
        </div>
        <div className="profile-stats">
          <span>
            <strong>{creator.followers}</strong>demo followers
          </span>
          <span>
            <strong>{state.following.includes(creator.id) ? "1" : "0"}</strong>
            your local follow
          </span>
        </div>
        <div className="profile-tags">
          {creator.tags.map((tag) => (
            <span className="category-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <DemoNotice>
        This is a fictional creator with illustrated posts and sample follower
        statistics. Interactions are browser-local; social links open the
        platform homepage.
      </DemoNotice>
      <div className="feed-layout profile-content-layout">
        <Feed creatorId={creator.id} />
        <aside className="feed-aside">
          <div className="membership-card">
            <span className="empty-flower">
              <Heart size={26} aria-hidden="true" />
            </span>
            <DemoBadge>Membership preview</DemoBadge>
            <h2>A little closer to the creative magic.</h2>
            <p>
              A glimpse of what a creator’s membership could feel like, one day.
            </p>
            <ul>
              <li>
                <Check size={14} aria-hidden="true" />
                Behind-the-scenes inspiration
              </li>
              <li>
                <Check size={14} aria-hidden="true" />
                Little creative extras
              </li>
              <li>
                <Check size={14} aria-hidden="true" />A closer community corner
              </li>
            </ul>
            <button disabled className="mimi-button">
              <LockKeyhole size={14} aria-hidden="true" />
              Payments are unavailable
            </button>
            <small>No purchases, subscriptions, or charges.</small>
          </div>
        </aside>
      </div>
    </>
  );
}
