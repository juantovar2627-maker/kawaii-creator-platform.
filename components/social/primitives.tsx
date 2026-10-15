import Link from "next/link";
import { avatars, themes } from "@/lib/creators/presets";
import type { SocialCreator } from "@/lib/social/types";
export function SocialIdentity({ creator }: { creator: SocialCreator | null }) {
  return creator ? (
    <Link className="social-identity" href={`/creators/${creator.username}`}>
      <span
        aria-hidden="true"
        className="social-avatar"
        style={{ backgroundColor: themes[creator.theme].color }}
      >
        {avatars[creator.avatar]}
      </span>
      <span>
        <strong>{creator.displayName}</strong>
        <small>@{creator.username}</small>
      </span>
    </Link>
  ) : (
    <span className="social-identity">
      <span className="social-avatar" aria-hidden="true">
        ✿
      </span>
      <strong>Mimi member</strong>
    </span>
  );
}
export function SocialFeedback({
  message,
  error,
}: {
  message?: string;
  error?: string;
}) {
  return (
    <>
      {message && (
        <p role="status" className="creator-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="creator-error">
          {error}
        </p>
      )}
    </>
  );
}
export function SocialPages({
  page,
  hasMore,
  busy = false,
  change,
  label,
}: {
  page: number;
  hasMore: boolean;
  busy?: boolean;
  change: (page: number) => void;
  label: string;
}) {
  return (
    <nav className="safety-pagination" aria-label={label}>
      <button
        className="mimi-button secondary small"
        disabled={page === 1 || busy}
        onClick={() => change(page - 1)}
      >
        Previous
      </button>
      <span>Page {page}</span>
      <button
        className="mimi-button secondary small"
        disabled={!hasMore || busy}
        onClick={() => change(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
