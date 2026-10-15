"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, Heart, MessageCircle, Send, Share2 } from "lucide-react";
import { creators, type DemoPost } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import { ArtworkPanel, CreatorAvatar, DemoBadge } from "./primitives";
import { SafetyMenu } from "./creator-card";

export function PostCard({
  post,
  compact = false,
}: {
  post: DemoPost;
  compact?: boolean;
}) {
  const creator = creators.find((item) => item.id === post.creatorId)!;
  const { state, toggle, comment, notify } = useDemo();
  const [showComments, setShowComments] = useState(false);
  const [text, setText] = useState("");
  const liked = state.liked.includes(post.id);
  const saved = state.saved.includes(post.id);
  const localComments = state.comments[post.id] || [];
  return (
    <article className={`post-card ${compact ? "post-compact" : ""}`}>
      <div className="post-header">
        <Link href={`/creators/${creator.username}`} className="post-author">
          <CreatorAvatar creator={creator} />
          <span>
            <strong>{creator.name}</strong>
            <span>
              @{creator.username} <span aria-hidden="true">·</span> {post.time}
            </span>
          </span>
        </Link>
        <SafetyMenu creator={creator} postId={post.id} />
      </div>
      {post.type === "video" ? (
        <div className="video-wrap">
          <video
            controls
            playsInline
            preload="none"
            aria-label={post.title}
            poster="/images/video-poster.svg"
          >
            <source src="/media/color-study.mp4" type="video/mp4" />
            <track
              kind="captions"
              src="/media/color-study.vtt"
              srcLang="en"
              label="English"
              default
            />
          </video>
          <span className="media-label">Silent demo animation · 4 seconds</span>
        </div>
      ) : (
        <Link
          href={`/creators/${creator.username}`}
          aria-label={`View ${post.title} on ${creator.name}'s profile`}
        >
          <ArtworkPanel
            art={post.art}
            label={post.title}
            className="post-artwork"
          />
        </Link>
      )}
      <div className="post-content">
        <div className="post-actions">
          <button
            aria-label={`${liked ? "Unlike" : "Like"} ${post.title}`}
            aria-pressed={liked}
            onClick={() => toggle("liked", post.id)}
            className={liked ? "is-liked" : ""}
          >
            <Heart
              size={21}
              fill={liked ? "currentColor" : "none"}
              aria-hidden="true"
            />
            <span>{post.likes + Number(liked)}</span>
          </button>
          <button
            aria-label={`Comments on ${post.title}`}
            aria-expanded={showComments}
            aria-controls={`comments-${post.id}`}
            onClick={() => setShowComments(!showComments)}
          >
            <MessageCircle size={21} aria-hidden="true" />
            <span>{post.comments.length + localComments.length}</span>
          </button>
          <button
            aria-label={`Share ${post.title}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${window.location.origin}/creators/${creator.username}`,
                );
                notify("Demo creator profile link copied.");
              } catch {
                notify(
                  "Open the creator profile to copy its link from your address bar.",
                );
              }
            }}
          >
            <Share2 size={20} />
          </button>
          <button
            className="save-button"
            aria-label={`${saved ? "Unsave" : "Save"} ${post.title}`}
            aria-pressed={saved}
            onClick={() => {
              toggle("saved", post.id);
              notify(
                saved
                  ? "Removed from your local saved posts."
                  : "Saved to your browser’s inspiration collection.",
              );
            }}
          >
            <Bookmark size={21} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
        <h3>{post.title}</h3>
        <p className="post-caption">{post.caption}</p>
        <div className="post-demo-line">
          <DemoBadge>Demo post</DemoBadge>
          <span>Illustrated inspiration, not a real creator post</span>
        </div>
        {showComments && (
          <div className="post-comments" id={`comments-${post.id}`}>
            <p className="comment-disclosure">
              Comments below are examples or browser-local drafts.
            </p>
            {post.comments.map((item, index) => (
              <p className="comment-line" key={index}>
                <strong>{item.name}</strong> {item.text}
              </p>
            ))}
            {localComments.map((item) => (
              <p className="comment-line" key={item.id}>
                <strong>You · local demo</strong> {item.text}
              </p>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                comment(post.id, text);
                setText("");
              }}
            >
              <label className="sr-only" htmlFor={`comment-${post.id}`}>
                Add a demo comment on {post.title}
              </label>
              <input
                id={`comment-${post.id}`}
                placeholder="Leave a little kindness…"
                value={text}
                maxLength={500}
                onChange={(event) => setText(event.target.value)}
                required
              />
              <button
                className="icon-button"
                type="submit"
                aria-label="Add demo comment"
              >
                <Send size={17} />
              </button>
            </form>
          </div>
        )}
      </div>
    </article>
  );
}
