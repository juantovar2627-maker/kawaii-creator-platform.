"use client";
import { useState } from "react";
import useSWR from "swr";
import { safetyRequest } from "@/components/safety/request";
import { useSocialAction } from "./actions";
import { SocialFeedback, SocialPages } from "./primitives";
import { PhotoGallery } from "@/components/media/gallery";
import type { Photo } from "@/lib/media/types";
import { VideoPlayer } from "@/components/video/player";
import type { CreatorVideo } from "@/lib/video/types";
type Kind = "posts" | "comments" | "reports" | "appeals";
type Item = {
  id: number;
  photos?: Photo[];
  video?: CreatorVideo | null;
  title?: string;
  body?: string;
  username?: string;
  status: string;
  revision?: number;
  moderationReason?: string;
  reason?: string;
  explanation?: string;
  resolution?: string;
  postId?: number;
  commentId?: number;
  entityType?: string;
  entityId?: number;
  snapshot?: Record<string, unknown>;
};
const tabs = {
  posts: "Post review",
  comments: "Comment moderation",
  reports: "Content reports",
  appeals: "Content review requests",
};
const statuses = {
  posts: ["pending", "published", "rejected", "removed", "all"],
  comments: ["visible", "removed", "all"],
  reports: ["open", "resolved", "dismissed", "all"],
  appeals: ["open", "reviewed", "all"],
};
export function SocialModeration() {
  const [kind, setKind] = useState<Kind>("posts");
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useSWR<{ items: Item[]; hasMore: boolean }>(
    `/api/admin/social?kind=${kind}&status=${status}&page=${page}`,
    safetyRequest,
  );
  const action = useSocialAction(true);
  return (
    <section className="social-moderation">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CARE FOR THE CONVERSATION</p>
          <h2>Post & comment moderation</h2>
          <p className="creator-help">
            Review all text, photos and videos. Human approval is mandatory;
            never approve explicit, exploitative, non-consensual or
            privacy-violating content. Production photos also require a passing
            configured scanner. Development previews are not content-scanned.
          </p>
        </div>
      </div>
      <nav className="category-filters" aria-label="Social moderation queues">
        {Object.entries(tabs).map(([key, label]) => (
          <button
            className={`filter-pill ${kind === key ? "selected" : ""}`}
            key={key}
            aria-pressed={kind === key}
            onClick={() => {
              setKind(key as Kind);
              setStatus(statuses[key as Kind][0]);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="studio-form moderation-filters">
        <label>
          Social status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {statuses[kind].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button className="text-link" onClick={() => void mutate()}>
          Reload content queue
        </button>
      </div>
      <SocialFeedback
        message={action.message}
        error={action.error || error?.message}
      />
      {!data && !error && <p role="status">Opening content moderation…</p>}
      {data?.items.length === 0 && (
        <p className="social-empty">No content matches this queue.</p>
      )}
      <div className="social-review-grid">
        {data?.items.map((item) => (
          <article className="account-panel social-review-item" key={item.id}>
            <span className="category-tag">
              {item.status} · #{item.id}
            </span>
            <h3>
              {item.title ||
                item.username ||
                `${kind === "comments" ? "Comment" : "Review"} #${item.id}`}
            </h3>
            {item.username && <p>@{item.username}</p>}
            {item.body && <p className="creator-text">{item.body}</p>}
            <PhotoGallery photos={item.photos} preview />
            <VideoPlayer video={item.video} privatePreview />
            {item.snapshot?.video != null && (
              <VideoPlayer
                video={item.snapshot.video as CreatorVideo}
                privatePreview
              />
            )}
            {Array.isArray(item.snapshot?.photos) && (
              <PhotoGallery photos={item.snapshot.photos as Photo[]} preview />
            )}
            {item.reason && <p className="creator-text">{item.reason}</p>}
            {item.explanation && (
              <p className="creator-text">{item.explanation}</p>
            )}
            {item.moderationReason && (
              <p className="creator-policy-note">{item.moderationReason}</p>
            )}
            {item.resolution && (
              <p className="creator-text">Response: {item.resolution}</p>
            )}
            {item.snapshot && (
              <details>
                <summary>Reported content / decision snapshot</summary>
                <pre
                  className="audit-snapshot"
                  tabIndex={0}
                  aria-label="Content evidence snapshot"
                >
                  {JSON.stringify(item.snapshot, null, 2)}
                </pre>
              </details>
            )}
            {kind === "reports" && (
              <p className="creator-help">
                Target:{" "}
                {item.commentId
                  ? `comment #${item.commentId}`
                  : `post #${item.postId}`}
                . Use the appropriate content queue to remove it; resolving this
                report alone does not change publication.
              </p>
            )}
            {kind === "appeals" && (
              <p className="creator-help">
                Decision concerns {item.entityType} #{item.entityId}. Review
                responses do not automatically change enforcement.
              </p>
            )}
            {(kind === "posts" ||
              kind === "comments" ||
              item.status === "open") && (
              <form
                className="studio-form safety-form"
                key={`${kind}-${item.id}-${item.revision || item.status}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const submitter = (event.nativeEvent as SubmitEvent)
                    .submitter as HTMLButtonElement;
                  const command = submitter.value;
                  void action.send(
                    kind === "posts" || kind === "comments"
                      ? {
                          action: command,
                          id: item.id,
                          revision: item.revision,
                          reason: form.get("reason"),
                          internalNote: form.get("internalNote"),
                        }
                      : kind === "reports"
                        ? {
                            action: "resolve_report",
                            id: item.id,
                            status: form.get("status"),
                            resolution: form.get("reason"),
                            internalNote: form.get("internalNote"),
                          }
                        : {
                            action: "review_appeal",
                            id: item.id,
                            resolution: form.get("reason"),
                            internalNote: form.get("internalNote"),
                          },
                  );
                }}
              >
                <label htmlFor={`content-reason-${kind}-${item.id}`}>
                  {kind === "posts" || kind === "comments"
                    ? "Author-visible content decision reason"
                    : "Response visible to submitting member"}
                </label>
                <p className="creator-help">
                  Explain the decision clearly. Never include reporter
                  identities or staff-only details.
                </p>
                <textarea
                  id={`content-reason-${kind}-${item.id}`}
                  name="reason"
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={3}
                />
                <label htmlFor={`content-note-${kind}-${item.id}`}>
                  Private content staff note
                </label>
                <textarea
                  id={`content-note-${kind}-${item.id}`}
                  name="internalNote"
                  maxLength={1000}
                  rows={2}
                />
                {kind === "reports" && (
                  <label>
                    Content report outcome
                    <select name="status">
                      <option value="resolved">Resolved</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </label>
                )}
                <div className="moderation-actions">
                  {kind === "posts" ? (
                    <>
                      {item.status === "pending" && (
                        <>
                          <button
                            value="approve_post"
                            className="mimi-button primary small"
                            disabled={action.busy}
                          >
                            Approve{" "}
                            {item.video
                              ? "video"
                              : item.photos?.length
                                ? "photo"
                                : "text"}{" "}
                            post
                          </button>
                          <button
                            value="reject_post"
                            className="mimi-button secondary small"
                            disabled={action.busy}
                          >
                            Reject{" "}
                            {item.video
                              ? "video"
                              : item.photos?.length
                                ? "photo"
                                : "text"}{" "}
                            post
                          </button>
                        </>
                      )}
                      {item.status !== "removed" ? (
                        <button
                          value="remove_post"
                          className="mimi-button secondary small"
                          disabled={action.busy}
                        >
                          Remove{" "}
                          {item.video
                            ? "video"
                            : item.photos?.length
                              ? "photo"
                              : "text"}{" "}
                          post
                        </button>
                      ) : (
                        <button
                          value="restore_post"
                          className="mimi-button secondary small"
                          disabled={action.busy}
                        >
                          Restore post to review
                        </button>
                      )}
                    </>
                  ) : kind === "comments" ? (
                    <button
                      value={
                        item.status === "removed"
                          ? "restore_comment"
                          : "remove_comment"
                      }
                      className="mimi-button secondary small"
                      disabled={action.busy}
                    >
                      {item.status === "removed"
                        ? "Restore comment"
                        : "Remove comment"}
                    </button>
                  ) : (
                    <button
                      className="mimi-button primary small"
                      disabled={action.busy}
                    >
                      {kind === "reports"
                        ? "Save content report review"
                        : "Save content review response"}
                    </button>
                  )}
                </div>
              </form>
            )}
          </article>
        ))}
      </div>
      <SocialPages
        page={page}
        hasMore={data?.hasMore || false}
        change={setPage}
        label="Content moderation pages"
      />
    </section>
  );
}
