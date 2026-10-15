import Link from "next/link";
import { ArrowUpRight, Heart, ShieldCheck } from "lucide-react";
import { avatars, themes, type PublicCreator } from "@/lib/creators/presets";

export function PresetAvatar({ creator }: { creator: PublicCreator }) {
  return (
    <span
      className="preset-avatar"
      role="img"
      aria-label={`${creator.displayName}'s ${creator.avatar} avatar`}
      style={{ backgroundColor: themes[creator.theme].color }}
    >
      {avatars[creator.avatar]}
    </span>
  );
}

export function RealCreatorCard({ creator }: { creator: PublicCreator }) {
  return (
    <article className="creator-card real-creator-card">
      <Link
        href={`/creators/${creator.username}`}
        className={`real-creator-cover creator-banner-${creator.banner}`}
        style={{ backgroundColor: themes[creator.theme].color }}
        aria-label={`Visit ${creator.displayName}'s creator profile`}
      >
        <span aria-hidden="true">✧ ♡ ✿</span>
        <span className="demo-badge">Community creator</span>
      </Link>
      <div className="creator-card-body">
        <PresetAvatar creator={creator} />
        <Link
          className="creator-name-link"
          href={`/creators/${creator.username}`}
        >
          <h3>
            {creator.displayName}
            <ArrowUpRight size={16} aria-hidden="true" />
          </h3>
          <span>@{creator.username}</span>
        </Link>
        <p className="creator-tagline">
          {creator.biography || "A new little corner of the community."}
        </p>
        <div className="profile-tags">
          {creator.categories.map((category) => (
            <span className="category-tag" key={category}>
              {category}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

export function RealCreatorProfile({
  creator,
  preview = false,
}: {
  creator: PublicCreator;
  preview?: boolean;
}) {
  const links = [
    ["Website", creator.websiteUrl],
    ["Instagram", creator.instagramUrl],
    ["YouTube", creator.youtubeUrl],
  ].filter(([, url]) => url);
  return (
    <>
      {preview && (
        <div className="demo-notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <p>
            Owner preview. This does not change your profile visibility.{" "}
            <Link href="/dashboard/creator-space" className="text-link">
              Back to My Creator Space
            </Link>
          </p>
        </div>
      )}
      <div
        className={`profile-banner real-profile-banner creator-banner-${creator.banner}`}
        style={{ backgroundColor: themes[creator.theme].color }}
      >
        <span className="real-banner-art" aria-hidden="true">
          ✿ <span>♡</span> ✧
        </span>
        <span className="demo-badge">Community creator · real profile</span>
      </div>
      <div className="profile-identity">
        <PresetAvatar creator={creator} />
        <button className="mimi-button secondary" disabled>
          Following coming later
        </button>
      </div>
      <div className="profile-main">
        <h1>{creator.displayName}</h1>
        <p className="profile-handle">@{creator.username}</p>
        <p className="profile-bio creator-text">
          {creator.biography ||
            "A little space for self-expression. More to come."}
        </p>
        <div className="profile-tags">
          {creator.categories.map((category) => (
            <span className="category-tag" key={category}>
              {category}
            </span>
          ))}
        </div>
        {links.length > 0 && (
          <div className="profile-details">
            {links.map(([label, url]) => (
              <a
                href={url}
                key={label}
                target="_blank"
                rel="nofollow ugc noopener noreferrer"
              >
                {label}
                <ArrowUpRight size={13} aria-hidden="true" />
                <span className="sr-only"> (external, opens a new tab)</span>
              </a>
            ))}
          </div>
        )}
        {links.length > 0 && (
          <p className="creator-help">
            External links are provided by this creator and are not verified by
            Mimi.
          </p>
        )}
      </div>
      <div className="feed-layout profile-content-layout">
        <section className="account-panel creator-empty">
          <span className="empty-flower" aria-hidden="true">
            ✿
          </span>
          <h2>A little beginning.</h2>
          <p>
            This is a real creator profile. Public posts, uploads, comments,
            messages, and follower counts are not available yet.
          </p>
          <Link href="/community-guidelines" className="text-link">
            Our non-explicit community rules
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </section>
        <aside className="feed-aside">
          <div className="membership-card">
            <Heart size={26} aria-hidden="true" />
            <h2>Room to grow, at your pace.</h2>
            <p>
              Memberships are a future possibility. No purchases, subscriptions,
              or charges are available.
            </p>
            <button className="mimi-button secondary" disabled>
              Payments are unavailable
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
