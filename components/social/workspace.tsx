"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { safetyRequest } from "@/components/safety/request";
import { useSocialAction } from "./actions";
import { SocialFeedback, SocialPages } from "./primitives";
import type { OwnPost, Page } from "@/lib/social/types";
export function PostWorkspace() {
  const [page, setPage] = useState(1);
  const { data, error } = useSWR<
    Page<OwnPost> & { creator: { username: string; eligible: boolean } | null }
  >(`/api/social?view=workspace&page=${page}`, safetyRequest);
  const action = useSocialAction();
  const [editing, setEditing] = useState<OwnPost | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const choose = (post: OwnPost | null) => {
    setEditing(post);
    setTitle(post?.title || "");
    setBody(post?.body || "");
  };
  return (
    <>
      {!data && !error && <p role="status">Opening your text studio…</p>}
      <SocialFeedback
        message={action.message}
        error={action.error || error?.message}
      />
      {data && !data.creator ? (
        <div className="account-panel">
          <h2>Your creator space comes first.</h2>
          <p>
            Create your optional public profile before writing real creator
            posts.
          </p>
          <Link className="mimi-button primary" href="/dashboard/creator-space">
            Set up My Creator Space
          </Link>
        </div>
      ) : (
        data && (
          <>
            <section className="account-panel">
              <h2>
                {editing
                  ? "Edit your text post"
                  : "A little note to your community"}
              </h2>
              <p className="creator-help">
                Plain text only. Editing a published or pending post withdraws
                it to a draft. Every new version needs fresh staff approval;
                removed posts require a review request.
              </p>
              {!data.creator?.eligible && (
                <p className="creator-policy-note">
                  Your creator profile needs active approval before posts can be
                  published. Drafts and pending submissions stay private.
                </p>
              )}
              <form
                className="studio-form safety-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = await action.send(
                    editing
                      ? {
                          action: "edit_post",
                          id: editing.id,
                          revision: editing.revision,
                          title,
                          body,
                        }
                      : { action: "create_post", title, body },
                  );
                  if (result) choose(null);
                }}
              >
                <label htmlFor="real-post-title">Post title (optional)</label>
                <input
                  id="real-post-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                />
                <label htmlFor="real-post-body">Your text post</label>
                <textarea
                  id="real-post-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                  maxLength={4000}
                  rows={7}
                />
                <span className="creator-help">
                  {body.length}/4000 characters · no uploads or embeds
                </span>
                <button className="mimi-button primary" disabled={action.busy}>
                  {editing ? "Save edited draft" : "Save real draft"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => choose(null)}
                  >
                    Cancel editing
                  </button>
                )}
              </form>
            </section>
            <section
              className="own-post-list"
              aria-label="Your real text posts"
            >
              <h2>Your drafts and submissions</h2>
              {data.items.length === 0 && (
                <p className="social-empty">
                  Your next little story starts above.
                </p>
              )}
              {data.items.map((post) => (
                <article className="account-panel" key={post.id}>
                  <span className="category-tag">{post.status}</span>
                  <h3>{post.title || "Untitled note"}</h3>
                  <p className="creator-text">{post.body}</p>
                  {post.moderationReason && (
                    <p className="creator-policy-note">
                      <strong>Moderator response:</strong>{" "}
                      {post.moderationReason}
                    </p>
                  )}
                  <div className="social-comment-actions">
                    {post.status !== "removed" && (
                      <button
                        className="mimi-button secondary small"
                        disabled={action.busy}
                        onClick={() => choose(post)}
                      >
                        {post.status === "published"
                          ? "Edit and withdraw"
                          : "Edit as draft"}
                      </button>
                    )}
                    {["draft", "rejected"].includes(post.status) && (
                      <button
                        className="mimi-button primary small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.send({
                            action: "submit_post",
                            id: post.id,
                            revision: post.revision,
                          })
                        }
                      >
                        Submit for review
                      </button>
                    )}
                    <details>
                      <summary>Withdraw / delete post</summary>
                      <p className="creator-help">
                        This removes it from your list and public surfaces while
                        retaining moderation history.
                      </p>
                      <button
                        className="mimi-button secondary small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.send({
                            action: "delete_post",
                            id: post.id,
                            revision: post.revision,
                          })
                        }
                      >
                        Confirm withdrawal
                      </button>
                    </details>
                    {["removed", "rejected"].includes(post.status) && (
                      <Link className="text-link" href="/dashboard/safety">
                        Decisions and review requests ↗
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </section>
            <SocialPages
              page={page}
              hasMore={data.hasMore}
              change={setPage}
              label="Your text post pages"
            />
          </>
        )
      )}
    </>
  );
}
