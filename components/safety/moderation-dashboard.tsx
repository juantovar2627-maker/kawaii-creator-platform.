"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { safetyRequest } from "./request";
import { PresetAvatar } from "@/components/creators/public-profile";
import type { PublicCreator } from "@/lib/creators/presets";
type Kind = "profiles" | "reports" | "appeals" | "activity";
type Item = {
  id: number;
  title?: string;
  username?: string;
  status?: string;
  rejected?: boolean;
  visibility?: string;
  reason: string;
  explanation?: string;
  resolution?: string;
  profileId?: number;
  action?: string;
  internalNote?: string;
  snapshot?: Record<string, unknown>;
  createdAt: string;
  actorRole?: string;
};
type Profile = PublicCreator & {
  id: number;
  revision: number;
  visibility: string;
  moderationStatus: string;
  listingRejected: boolean;
  moderationReason: string;
};
type Queue = {
  overview: { pending: number; reports: number; appeals: number };
  items: Item[];
  hasMore: boolean;
  profile?: Profile;
};
const tabs = {
  profiles: "Creator approvals",
  reports: "Reports",
  appeals: "Review requests",
  activity: "Moderation activity",
};
const filters = {
  profiles: ["pending", "approved", "rejected", "suspended", "all"],
  reports: ["open", "resolved", "dismissed", "all"],
  appeals: ["open", "reviewed", "all"],
  activity: ["all"],
};
export function ModerationDashboard() {
  const [kind, setKind] = useState<Kind>("profiles");
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<Queue>(
    `/api/admin/moderation?kind=${kind}&status=${status}&q=${encodeURIComponent(q)}&page=${page}`,
    safetyRequest,
  );
  const {
    data: detail,
    error: detailError,
    mutate: reloadDetail,
  } = useSWR<Queue>(
    selected
      ? `/api/admin/moderation?kind=profile&id=${selected}&page=${historyPage}`
      : null,
    safetyRequest,
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(body: unknown) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await safetyRequest("/api/admin/moderation", body);
      setMessage(result.message);
      await Promise.all([mutate(), reloadDetail()]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const profile = detail?.profile;
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    reviewHeading.current?.focus();
  }, [profile?.id]);
  return (
    <>
      <div className="moderation-overview">
        {[
          ["Pending creators", data?.overview.pending],
          ["Open reports", data?.overview.reports],
          ["Review requests", data?.overview.appeals],
        ].map(([label, value]) => (
          <div className="account-panel" key={label}>
            <span>{label}</span>
            <strong>{value ?? "…"}</strong>
          </div>
        ))}
      </div>
      <nav className="category-filters" aria-label="Moderation queues">
        {Object.entries(tabs).map(([key, label]) => (
          <button
            key={key}
            className={`filter-pill ${kind === key ? "selected" : ""}`}
            aria-pressed={kind === key}
            onClick={() => {
              setKind(key as Kind);
              setStatus(filters[key as Kind][0]);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="moderation-filters studio-form">
        <label>
          Status filter
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {filters[kind].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {kind === "profiles" && (
          <label>
            Search creator reviews
            <input
              type="search"
              value={q}
              maxLength={80}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              placeholder="Username or display name"
            />
          </label>
        )}
      </div>
      {message && (
        <p className="creator-success" role="status">
          {message}
        </p>
      )}
      {(error || loadError || detailError) && (
        <p className="creator-error" role="alert">
          {error || loadError?.message || detailError?.message}
        </p>
      )}
      <div className={`moderation-layout ${selected ? "with-review" : ""}`}>
        <section className="moderation-queue" aria-label={tabs[kind]}>
          {!data && !loadError && (
            <p role="status">Opening the moderation queue…</p>
          )}
          {data?.items.length === 0 && (
            <div className="account-panel">
              <h2>All quiet here.</h2>
              <p>No items match these filters.</p>
            </div>
          )}
          {data?.items.map((item) => (
            <article className="account-panel" key={item.id}>
              <span className="category-tag">
                {item.rejected ? "rejected" : item.status || item.actorRole}
              </span>
              <h2>{item.title || item.action?.replaceAll("_", " ")}</h2>
              {item.username && (
                <p>
                  @{item.username} · {item.visibility}
                </p>
              )}
              <p className="creator-text">{item.reason}</p>
              {item.explanation && (
                <p className="creator-text">{item.explanation}</p>
              )}
              {item.resolution && (
                <p className="creator-text">
                  <strong>Response:</strong> {item.resolution}
                </p>
              )}
              <p className="creator-help">
                {new Date(item.createdAt).toLocaleString()}
              </p>
              {(kind === "profiles" || item.profileId) && (
                <button
                  className="mimi-button secondary small"
                  onClick={() => {
                    setSelected(
                      kind === "profiles" ? item.id : item.profileId!,
                    );
                    setHistoryPage(1);
                  }}
                >
                  Review profile
                </button>
              )}
              {(kind === "activity" || kind === "reports") && (
                <AuditDetails item={item} />
              )}
              {(kind === "reports" || kind === "appeals") &&
                item.status === "open" && (
                  <form
                    className="studio-form safety-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void send(
                        kind === "reports"
                          ? {
                              action: "resolve_report",
                              reportId: item.id,
                              status: form.get("status"),
                              resolution: form.get("resolution"),
                              internalNote: form.get("internalNote"),
                            }
                          : {
                              action: "review_appeal",
                              appealId: item.id,
                              resolution: form.get("resolution"),
                              internalNote: form.get("internalNote"),
                            },
                      );
                    }}
                  >
                    <label htmlFor={`resolution-${kind}-${item.id}`}>
                      Response visible to{" "}
                      {kind === "reports" ? "reporter" : "creator"}
                    </label>
                    <textarea
                      id={`resolution-${kind}-${item.id}`}
                      name="resolution"
                      required
                      minLength={10}
                      maxLength={1000}
                      rows={3}
                    />
                    <label htmlFor={`internal-${item.id}`}>
                      Internal note (staff only)
                    </label>
                    <textarea
                      id={`internal-${item.id}`}
                      name="internalNote"
                      maxLength={1000}
                      rows={2}
                    />
                    {kind === "reports" && (
                      <label>
                        Report outcome
                        <select name="status">
                          <option value="resolved">Resolved</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      </label>
                    )}
                    {kind === "appeals" && (
                      <p className="creator-help">
                        If the decision should change, also use the profile
                        controls. This response alone does not alter
                        enforcement.
                      </p>
                    )}
                    <button className="mimi-button primary" disabled={busy}>
                      {kind === "reports"
                        ? "Save report review"
                        : "Save review response"}
                    </button>
                  </form>
                )}
            </article>
          ))}
          <nav
            className="safety-pagination"
            aria-label="Moderation queue pages"
          >
            <button
              className="mimi-button secondary small"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="mimi-button secondary small"
              disabled={!data?.hasMore}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </nav>
        </section>
        {selected && (
          <aside
            className="account-panel moderation-review"
            aria-label="Profile review panel"
          >
            <div className="flex justify-between gap-3">
              <h2 ref={reviewHeading} tabIndex={-1}>
                Profile review
              </h2>
              <button className="text-link" onClick={() => setSelected(null)}>
                Close review
              </button>
            </div>
            <button className="text-link" onClick={() => void reloadDetail()}>
              Reload profile
            </button>
            {profile && (
              <>
                <PresetAvatar creator={profile} />
                <h3>{profile.displayName}</h3>
                <p>@{profile.username}</p>
                <p className="category-tag">
                  {profile.listingRejected
                    ? "rejected"
                    : profile.moderationStatus}{" "}
                  · {profile.visibility} · revision {profile.revision}
                </p>
                <p className="creator-text">{profile.biography}</p>
                <p>{profile.categories.join(" · ")}</p>
                <p className="creator-help">
                  Theme: {profile.theme} · Avatar: {profile.avatar} · Banner:{" "}
                  {profile.banner}
                </p>
                {[
                  ["Website", profile.websiteUrl],
                  ["Instagram", profile.instagramUrl],
                  ["YouTube", profile.youtubeUrl],
                ]
                  .filter(([, url]) => url)
                  .map(([label, url]) => (
                    <p key={label}>
                      <a
                        className="text-link creator-text"
                        href={url}
                        target="_blank"
                        rel="nofollow ugc noopener noreferrer"
                      >
                        {label}: {url} ↗
                        <span className="sr-only"> (opens a new tab)</span>
                      </a>
                    </p>
                  ))}
                {profile.moderationReason && (
                  <p className="creator-text">
                    <strong>Current reason:</strong> {profile.moderationReason}
                  </p>
                )}
                <form
                  className="studio-form safety-form"
                  key={`${profile.id}-${profile.revision}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const native = event.nativeEvent as SubmitEvent;
                    const action = (native.submitter as HTMLButtonElement)
                      ?.value;
                    if (!action) return;
                    const form = new FormData(event.currentTarget);
                    void send({
                      action,
                      profileId: profile.id,
                      revision: profile.revision,
                      reason: form.get("reason"),
                      internalNote: form.get("internalNote"),
                    });
                  }}
                >
                  <label htmlFor="decision-reason">
                    Creator-visible decision reason
                  </label>
                  <p className="creator-help">
                    Explain the rule and next steps. Never include reporter
                    identities or private details.
                  </p>
                  <textarea
                    id="decision-reason"
                    name="reason"
                    required
                    minLength={10}
                    maxLength={1000}
                    rows={4}
                  />
                  <label htmlFor="decision-internal">
                    Internal note (staff only)
                  </label>
                  <textarea
                    id="decision-internal"
                    name="internalNote"
                    maxLength={1000}
                    rows={3}
                  />
                  <div className="moderation-actions">
                    {(["approve", "reject", "suspend", "restore"] as const).map(
                      (action) => (
                        <button
                          className={`mimi-button ${action === "approve" ? "primary" : "secondary"} small`}
                          name="action"
                          value={action}
                          key={action}
                          disabled={
                            busy ||
                            ((action === "approve" || action === "reject") &&
                              (profile.visibility !== "listed" ||
                                profile.moderationStatus === "suspended")) ||
                            (action === "restore" &&
                              profile.moderationStatus !== "suspended") ||
                            (action === "suspend" &&
                              profile.moderationStatus === "suspended")
                          }
                        >
                          {action[0].toUpperCase() + action.slice(1)} profile
                        </button>
                      ),
                    )}
                  </div>
                  <p className="creator-help">
                    Restoration returns a profile to pending review. Hidden and
                    unlisted visibility remain unchanged.
                  </p>
                </form>
                <h3>Decision history</h3>
                {detail.items.map((item) => (
                  <div className="safety-item" key={item.id}>
                    <strong>{item.action?.replaceAll("_", " ")}</strong>
                    <p className="creator-text">{item.reason}</p>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                    <AuditDetails item={item} />
                  </div>
                ))}
                <nav
                  className="safety-pagination"
                  aria-label="Profile history pages"
                >
                  <button
                    className="text-link"
                    disabled={historyPage === 1}
                    onClick={() => setHistoryPage((value) => value - 1)}
                  >
                    Newer
                  </button>
                  <span>{historyPage}</span>
                  <button
                    className="text-link"
                    disabled={!detail.hasMore}
                    onClick={() => setHistoryPage((value) => value + 1)}
                  >
                    Older
                  </button>
                </nav>
              </>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
function AuditDetails({ item }: { item: Item }) {
  return (
    <details>
      <summary>Staff note and saved snapshot</summary>
      <p className="creator-text">{item.internalNote || "No internal note."}</p>
      <pre className="audit-snapshot">
        {JSON.stringify(item.snapshot || {}, null, 2)}
      </pre>
    </details>
  );
}
