"use client";
import Link from "next/link";
import { useState } from "react";
import { Bookmark, Heart, MessageCircle } from "lucide-react";
import useSWR from "swr";
import { safetyRequest } from "@/components/safety/request";
import { useSocialAction } from "./actions";
import { SocialFeedback, SocialIdentity, SocialPages } from "./primitives";
import { RealComments } from "./comments";
import { ContentReport } from "./report";
import type { Page, PublicPost } from "@/lib/social/types";
import { PhotoGallery } from "@/components/media/gallery";
import { VideoPlayer } from "@/components/video/player";
function RealPostCard({ post }: { post: PublicPost }) {
  const { data: user } = useSWR("/api/user");
  const [comments, setComments] = useState(false);
  const action = useSocialAction();
  return (
    <article className="real-post-card" id={`real-post-${post.id}`}>
      <div className="real-post-header">
        <SocialIdentity creator={post.creator} />
        <span className="category-tag">
          Community post ·{" "}
          {post.video ? "video" : post.photos?.length ? "photos" : "text"}
        </span>
      </div>
      <time dateTime={post.publishedAt}>
        {new Date(post.publishedAt).toLocaleString()}
      </time>
      {post.title && <h3>{post.title}</h3>}
      <p className="real-post-body creator-text">{post.body}</p>
      <PhotoGallery photos={post.photos} />
      <VideoPlayer video={post.video} />
      <div className="real-post-actions">
        <button
          className="social-action-button"
          disabled={!user || action.busy}
          aria-label={`${post.liked ? "Unlike" : "Like"} real post ${post.id}`}
          aria-pressed={post.liked}
          onClick={() =>
            void action.send({
              action: "like",
              postId: post.id,
              liked: !post.liked,
            })
          }
        >
          <Heart
            size={18}
            aria-hidden="true"
            fill={post.liked ? "currentColor" : "none"}
          />
          {post.likes}
          <span className="sr-only"> likes</span>
        </button>
        <button
          className="social-action-button"
          aria-expanded={comments}
          aria-controls={`real-comments-${post.id}`}
          onClick={() => setComments((value) => !value)}
        >
          <MessageCircle size={18} aria-hidden="true" />
          {post.comments}
          <span> comments</span>
        </button>
        <button
          className="social-action-button"
          disabled={!user || action.busy}
          aria-pressed={post.saved}
          onClick={() =>
            void action.send({
              action: "save",
              postId: post.id,
              saved: !post.saved,
            })
          }
        >
          <Bookmark
            size={18}
            aria-hidden="true"
            fill={post.saved ? "currentColor" : "none"}
          />
          {post.saved ? "Unsave post" : "Save post"}
        </button>
        {post.mine && (
          <Link className="text-link" href="/dashboard/posts">
            Manage your post
          </Link>
        )}
      </div>
      {!user && (
        <p className="creator-help">
          <Link className="text-link" href="/sign-in">
            Sign in to like, save, comment, or report
          </Link>
        </p>
      )}
      <SocialFeedback message={action.message} error={action.error} />
      {!!user && !post.mine && <ContentReport target="post" id={post.id} />}
      <div id={`real-comments-${post.id}`}>
        {comments && <RealComments postId={post.id} />}
      </div>
    </article>
  );
}
export function RealFeed({
  scope = "main",
  username,
  title = "From the real community",
}: {
  scope?: "main" | "home" | "creator" | "following" | "saved";
  username?: string;
  title?: string;
}) {
  const [page, setPage] = useState(1);
  const { data: user } = useSWR("/api/user");
  const locked = (scope === "following" || scope === "saved") && !user;
  const { data, error, isLoading } = useSWR<Page<PublicPost>>(
    locked
      ? null
      : `/api/social?view=feed&scope=${scope}&page=${page}${username ? `&username=${username}` : ""}`,
    safetyRequest,
  );
  return (
    <section className="real-feed" aria-label={title}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">REAL VOICES, LITTLE MOMENTS</p>
          <h2>{title}</h2>
        </div>
        {scope === "home" && (
          <Link className="text-link" href="/feed">
            All community posts ↗
          </Link>
        )}
      </div>
      {isLoading && <p role="status">Finding lovely little moments…</p>}
      {locked && (
        <p className="social-empty">
          <Link className="text-link" href="/sign-in">
            Sign in to see your real{" "}
            {scope === "saved" ? "saved posts" : "following feed"}.
          </Link>
        </p>
      )}
      <SocialFeedback error={error?.message} />
      {data?.items.length === 0 && (
        <div className="social-empty">
          <strong>
            {scope === "saved"
              ? "Your private collection starts here."
              : scope === "following"
                ? "Your creator circle is a little quiet."
                : "A little beginning."}
          </strong>
          <p>
            {scope === "saved"
              ? "Save a real post to keep it here across devices. Unavailable posts stay hidden."
              : "Approved text, photo and video posts from eligible creators will appear here. Demo content, where shown, is labeled separately."}
          </p>
          <Link
            className="text-link"
            href={scope === "saved" ? "/feed" : "/discover"}
          >
            {scope === "saved"
              ? "Explore community posts"
              : "Discover creators"}{" "}
            ↗
          </Link>
        </div>
      )}
      <div className="real-post-list">
        {data?.items.map((post) => <RealPostCard key={post.id} post={post} />)}
      </div>
      {scope !== "home" && (
        <SocialPages
          page={page}
          hasMore={data?.hasMore || false}
          change={setPage}
          label={`${title} pages`}
        />
      )}
    </section>
  );
}
