"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { safetyRequest } from "./request";

type Block = { id: number; username: string; displayName: string };
type Report = {
  id: number;
  username: string;
  reason: string;
  explanation: string;
  status: string;
  resolution: string;
  createdAt: string;
};
type Decision = {
  id: number;
  action: string;
  reason: string;
  createdAt: string;
};
type Appeal = {
  id: number;
  decisionId: number;
  explanation: string;
  status: string;
  resolution: string;
};
type Data = {
  blocks: Block[];
  reports: Report[];
  decisions: Decision[];
  appeals: Appeal[];
  hasMore: boolean;
};
export function AccountSafety() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<Data>(`/api/safety?page=${page}`, safetyRequest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function send(body: unknown) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await safetyRequest("/api/safety", body);
      setMessage(result.message);
      await mutate();
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {message && (
        <p role="status" className="creator-success">
          {message}
        </p>
      )}
      {(error || loadError) && (
        <p role="alert" className="creator-error">
          {error || loadError?.message}
        </p>
      )}
      {!data && !loadError && <p role="status">Opening your safety space…</p>}
      {data && (
        <div className="safety-grid">
          <section className="account-panel">
            <h2>Blocked real accounts</h2>
            <p>
              Saved across sessions and devices. Public information remains
              accessible anonymously. Demo blocks stay separate in your local
              demo settings.
            </p>
            {!data.blocks.length && (
              <p className="creator-help">No blocks on this page.</p>
            )}
            {data.blocks.map((block) => (
              <div className="safety-item" key={block.id}>
                <strong>{block.displayName}</strong>
                <p>@{block.username} · name saved when blocked</p>
                <button
                  disabled={busy}
                  className="mimi-button secondary small"
                  onClick={() =>
                    void send({ action: "unblock", blockId: block.id })
                  }
                >
                  Unblock @{block.username}
                </button>
              </div>
            ))}
          </section>
          <section className="account-panel">
            <h2>Your reports</h2>
            <p>
              Only your reports are shown here. A saved report is awaiting human
              review; submitting one does not automatically suspend a creator.
            </p>
            {!data.reports.length && (
              <p className="creator-help">No reports on this page.</p>
            )}
            {data.reports.map((report) => (
              <div className="safety-item" key={report.id}>
                <span className="category-tag">{report.status}</span>
                <h3>
                  @{report.username} · {report.reason}
                </h3>
                <p className="creator-text">{report.explanation}</p>
                {report.resolution && (
                  <p className="creator-text">
                    <strong>Moderator response:</strong> {report.resolution}
                  </p>
                )}
                <small>{new Date(report.createdAt).toLocaleDateString()}</small>
              </div>
            ))}
          </section>
          <section className="account-panel">
            <h2>Your creator decisions</h2>
            <p>
              Rejections and suspensions can be sent for another review, once
              per decision. A review request does not automatically change
              profile visibility or enforcement.
            </p>
            {!data.decisions.length && (
              <p className="creator-help">No decisions on this page.</p>
            )}
            {data.decisions.map((decision) => (
              <div className="safety-item" key={decision.id}>
                <h3>
                  {decision.action.replace("profile_", "").replaceAll("_", " ")}
                </h3>
                <p className="creator-text">{decision.reason}</p>
                <small>
                  {new Date(decision.createdAt).toLocaleDateString()}
                </small>
                {["profile_rejected", "profile_suspended"].includes(
                  decision.action,
                ) &&
                  !data.appeals.some(
                    (appeal) => appeal.decisionId === decision.id,
                  ) && (
                    <details>
                      <summary>Request another review</summary>
                      <form
                        className="studio-form safety-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void send({
                            action: "appeal",
                            decisionId: decision.id,
                            explanation: new FormData(event.currentTarget).get(
                              "explanation",
                            ),
                          });
                        }}
                      >
                        <label htmlFor={`appeal-${decision.id}`}>
                          Why should we review this decision?
                        </label>
                        <textarea
                          id={`appeal-${decision.id}`}
                          name="explanation"
                          required
                          minLength={10}
                          maxLength={1000}
                          rows={3}
                        />
                        <button
                          className="mimi-button secondary"
                          disabled={busy}
                        >
                          Send review request
                        </button>
                      </form>
                    </details>
                  )}
              </div>
            ))}
          </section>
          <section className="account-panel">
            <h2>Your review requests</h2>
            {!data.appeals.length && (
              <p className="creator-help">No review requests on this page.</p>
            )}
            {data.appeals.map((appeal) => (
              <div className="safety-item" key={appeal.id}>
                <span className="category-tag">{appeal.status}</span>
                <p className="creator-text">{appeal.explanation}</p>
                {appeal.resolution && (
                  <p className="creator-text">
                    <strong>Moderator response:</strong> {appeal.resolution}
                  </p>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
      <nav className="safety-pagination" aria-label="Safety history pages">
        <button
          className="mimi-button secondary small"
          disabled={page === 1 || busy}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className="mimi-button secondary small"
          disabled={!data?.hasMore || busy}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </nav>
    </>
  );
}
