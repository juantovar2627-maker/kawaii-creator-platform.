"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { safetyRequest } from "@/components/safety/request";
import { useSocialAction } from "./actions";
import { SocialFeedback, SocialIdentity, SocialPages } from "./primitives";
import { ContentReport } from "./report";
import type { Page, PublicComment } from "@/lib/social/types";
function Comment({
  comment,
  canInteract,
}: {
  comment: PublicComment;
  canInteract: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const action = useSocialAction();
  return (
    <article className="real-comment">
      <SocialIdentity creator={comment.author} />
      <small>{new Date(comment.createdAt).toLocaleString()}</small>
      {editing ? (
        <form
          className="studio-form safety-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await action.send({
              action: "edit_comment",
              id: comment.id,
              revision: comment.revision,
              body: new FormData(event.currentTarget).get("body"),
            });
            if (result) setEditing(false);
          }}
        >
          <label htmlFor={`edit-comment-${comment.id}`}>
            Edit your comment
          </label>
          <textarea
            id={`edit-comment-${comment.id}`}
            name="body"
            defaultValue={comment.body}
            required
            maxLength={600}
            rows={3}
          />
          <button
            disabled={action.busy}
            className="mimi-button secondary small"
          >
            Save comment
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => setEditing(false)}
          >
            Cancel edit
          </button>
        </form>
      ) : (
        <p className="creator-text">{comment.body}</p>
      )}
      {comment.mine ? (
        <div className="social-comment-actions">
          <button
            className="text-link"
            disabled={action.busy}
            onClick={() => setEditing(true)}
          >
            Edit comment
          </button>
          <button
            className="text-link"
            disabled={action.busy}
            onClick={() =>
              void action.send({
                action: "delete_comment",
                id: comment.id,
                revision: comment.revision,
              })
            }
          >
            Delete comment
          </button>
        </div>
      ) : (
        canInteract && (
          <>
            <ContentReport target="comment" id={comment.id} />
            <details className="social-report">
              <summary>Block comment author</summary>
              <p className="creator-help">
                Hides this account across your signed-in social spaces,
                including members without a creator profile. Public content
                remains accessible anonymously.
              </p>
              <button
                className="mimi-button secondary small"
                disabled={action.busy}
                onClick={() =>
                  void action.send({
                    action: "block_comment_author",
                    commentId: comment.id,
                  })
                }
              >
                Confirm comment author block
              </button>
            </details>
          </>
        )
      )}
      <SocialFeedback message={action.message} error={action.error} />
    </article>
  );
}
export function RealComments({ postId }: { postId: number }) {
  const { data: user } = useSWR("/api/user");
  const [page, setPage] = useState(1);
  const { data, error } = useSWR<Page<PublicComment>>(
    `/api/social?view=comments&id=${postId}&page=${page}`,
    safetyRequest,
  );
  const action = useSocialAction();
  return (
    <section className="real-comments" aria-label="Real post comments">
      <h4>Community comments</h4>
      <p className="creator-help">
        Plain text only, up to 600 characters. Without a visible creator
        profile, your public name is “Mimi member.” Hiding your profile does not
        delete your comments.
      </p>
      {user ? (
        <form
          className="studio-form safety-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const result = await action.send({
              action: "comment",
              postId,
              body: new FormData(form).get("body"),
            });
            if (result) {
              form.reset();
              setPage(1);
            }
          }}
        >
          <label htmlFor={`new-comment-${postId}`}>Add a real comment</label>
          <textarea
            id={`new-comment-${postId}`}
            name="body"
            required
            maxLength={600}
            rows={3}
          />
          <button className="mimi-button primary small" disabled={action.busy}>
            Post comment
          </button>
        </form>
      ) : (
        <Link className="text-link" href="/sign-in">
          Sign in to comment
        </Link>
      )}
      <SocialFeedback
        message={action.message}
        error={action.error || error?.message}
      />
      {!data && !error && <p role="status">Loading comments…</p>}
      {data?.items.length === 0 && (
        <p className="social-empty">A little room for a kind conversation.</p>
      )}
      {data?.items.map((comment) => (
        <Comment key={comment.id} comment={comment} canInteract={!!user} />
      ))}
      <SocialPages
        page={page}
        hasMore={data?.hasMore || false}
        change={setPage}
        label={`Comment pages for post ${postId}`}
      />
    </section>
  );
}
