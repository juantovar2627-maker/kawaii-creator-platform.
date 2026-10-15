"use client";
import { useState } from "react";
import useSWR from "swr";
import { safetyRequest } from "@/components/safety/request";
import { useSocialAction } from "./actions";
import { SocialFeedback, SocialPages } from "./primitives";
type RecordItem = {
  id: number;
  action?: string;
  reason?: string;
  body?: string;
  status?: string;
  resolution?: string;
  explanation?: string;
  decisionId?: number;
  entityType?: string;
  entityId?: number;
  moderationReason?: string;
  revision?: number;
};
type Data = {
  reports: RecordItem[];
  decisions: RecordItem[];
  appeals: RecordItem[];
  comments: RecordItem[];
  hasMore: boolean;
};
export function SocialActivity() {
  const [page, setPage] = useState(1);
  const { data, error } = useSWR<Data>(
    `/api/social?view=activity&page=${page}`,
    safetyRequest,
  );
  const action = useSocialAction();
  return (
    <section className="social-activity">
      <h2>Social Activity & review requests</h2>
      <p className="creator-help">
        Your real post/comment reports, enforcement decisions, requests for
        another review, and comments. These records are private to your account.
      </p>
      <SocialFeedback
        message={action.message}
        error={action.error || error?.message}
      />
      {!data && !error && <p role="status">Loading your social history…</p>}
      {data && (
        <div className="safety-grid">
          <section className="account-panel">
            <h3>Your content reports</h3>
            {!data.reports.length && (
              <p className="social-empty">No content reports on this page.</p>
            )}
            {data.reports.map((item) => (
              <div className="safety-item" key={item.id}>
                <strong>
                  {item.reason} · {item.status}
                </strong>
                <p className="creator-text">{item.explanation}</p>
                {item.resolution && (
                  <p className="creator-text">
                    Moderator response: {item.resolution}
                  </p>
                )}
              </div>
            ))}
          </section>
          <section className="account-panel">
            <h3>Content decisions</h3>
            {!data.decisions.length && (
              <p className="social-empty">No content decisions on this page.</p>
            )}
            {data.decisions.map((item) => (
              <div className="safety-item" key={item.id}>
                <strong>
                  {item.action?.replaceAll("_", " ")} · {item.entityType} #
                  {item.entityId}
                </strong>
                <p className="creator-text">{item.reason}</p>
                {["post_rejected", "post_removed", "comment_removed"].includes(
                  item.action || "",
                ) &&
                  !data.appeals.some(
                    (appeal) => appeal.decisionId === item.id,
                  ) && (
                    <details>
                      <summary>Request review of this content decision</summary>
                      <form
                        className="studio-form safety-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void action.send({
                            action: "appeal",
                            decisionId: item.id,
                            explanation: new FormData(event.currentTarget).get(
                              "explanation",
                            ),
                          });
                        }}
                      >
                        <label htmlFor={`social-appeal-${item.id}`}>
                          Explain your review request
                        </label>
                        <textarea
                          id={`social-appeal-${item.id}`}
                          name="explanation"
                          minLength={10}
                          maxLength={1000}
                          required
                          rows={3}
                        />
                        <button
                          className="mimi-button secondary small"
                          disabled={action.busy}
                        >
                          Send content review request
                        </button>
                      </form>
                    </details>
                  )}
              </div>
            ))}
          </section>
          <section className="account-panel">
            <h3>Your content review requests</h3>
            {!data.appeals.length && (
              <p className="social-empty">
                No content review requests on this page.
              </p>
            )}
            {data.appeals.map((item) => (
              <div className="safety-item" key={item.id}>
                <strong>{item.status}</strong>
                <p className="creator-text">{item.explanation}</p>
                {item.resolution && (
                  <p className="creator-text">
                    Moderator response: {item.resolution}
                  </p>
                )}
              </div>
            ))}
          </section>
          <section className="account-panel">
            <h3>Your comments</h3>
            <p className="creator-help">
              Your text remains available here when a parent post is
              unavailable. This view does not reveal hidden post content.
            </p>
            {!data.comments.length && (
              <p className="social-empty">No comments on this page.</p>
            )}
            {data.comments.map((item) => (
              <div className="safety-item" key={item.id}>
                <span className="category-tag">{item.status}</span>
                <p className="creator-text">{item.body}</p>
                {item.moderationReason && (
                  <p className="creator-text">
                    Moderator response: {item.moderationReason}
                  </p>
                )}
                <button
                  className="text-link"
                  disabled={action.busy}
                  onClick={() =>
                    void action.send({
                      action: "delete_comment",
                      id: item.id,
                      revision: item.revision,
                    })
                  }
                >
                  Delete your comment
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
      <SocialPages
        page={page}
        hasMore={data?.hasMore || false}
        change={setPage}
        label="Social activity pages"
      />
    </section>
  );
}
