"use client";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { safetyRequest } from "@/components/safety/request";
import { useSocialAction } from "./actions";
import { SocialFeedback, SocialIdentity, SocialPages } from "./primitives";
import type { Page, SocialCreator } from "@/lib/social/types";
export function RealFollow({ username }: { username: string }) {
  const { data: user } = useSWR("/api/user");
  const { data, error } = useSWR<{
    followers: number;
    following: boolean;
    mine: boolean;
  }>(`/api/social?view=creator&username=${username}`, safetyRequest);
  const action = useSocialAction();
  return (
    <div className="real-follow">
      <p className="real-follower-count">
        <strong>{data?.followers ?? "…"}</strong>{" "}
        {data?.followers === 1 ? "follower" : "followers"}{" "}
        <span>· real community</span>
      </p>
      {!data?.mine &&
        (user ? (
          <button
            className={`mimi-button ${data?.following ? "secondary" : "primary"} small`}
            disabled={!data || action.busy}
            aria-pressed={data?.following || false}
            onClick={() =>
              void action.send({
                action: "follow",
                username,
                following: !data?.following,
              })
            }
          >
            {data?.following ? "Unfollow creator" : "Follow creator"}
          </button>
        ) : (
          <Link className="text-link" href="/sign-in">
            Sign in to follow
          </Link>
        ))}
      <SocialFeedback
        message={action.message}
        error={action.error || error?.message}
      />
    </div>
  );
}
export function RealFollowing() {
  const { data: user } = useSWR("/api/user");
  const [page, setPage] = useState(1);
  const { data, error } = useSWR<Page<SocialCreator>>(
    user ? `/api/social?view=following&page=${page}` : null,
    safetyRequest,
  );
  return (
    <section className="real-following">
      <h2>Your real creator circle</h2>
      {!user ? (
        <p>
          <Link className="text-link" href="/sign-in">
            Sign in to see your real follows.
          </Link>
        </p>
      ) : (
        <>
          {!data && !error && <p role="status">Finding your creator circle…</p>}
          <SocialFeedback error={error?.message} />
          {data?.items.length === 0 && (
            <p className="social-empty">
              Follow a real creator from their public profile. Your follows are
              saved to your account across devices.
            </p>
          )}
          <div className="social-follow-grid">
            {data?.items.map((creator) => (
              <article className="account-panel" key={creator.username}>
                <SocialIdentity creator={creator} />
                <RealFollow username={creator.username} />
              </article>
            ))}
          </div>
          <SocialPages
            page={page}
            hasMore={data?.hasMore || false}
            change={setPage}
            label="Followed creator pages"
          />
        </>
      )}
    </section>
  );
}
