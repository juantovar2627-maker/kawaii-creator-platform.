"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCheck, Heart, Sparkles } from "lucide-react";
import { creators } from "@/lib/demo/community";
import { useDemo } from "./demo-provider";
import { CreatorAvatar } from "./primitives";

export function Notifications() {
  const { state, markNotificationsRead, notify } = useDemo();
  return (
    <>
      <div className="flex justify-end mb-4">
        <button
          className="mimi-button secondary small"
          disabled={state.notificationsRead}
          onClick={() => {
            markNotificationsRead();
            notify("Sample notifications marked as read in this browser.");
          }}
        >
          <CheckCheck size={15} aria-hidden="true" />
          {state.notificationsRead ? "All caught up" : "Mark preview as read"}
        </button>
      </div>
      <div className="notifications-list">
        {creators
          .filter((creator) => !state.blocked.includes(creator.id))
          .slice(0, 3)
          .map((creator, index) => (
            <Link
              className={`notification ${state.notificationsRead ? "" : "unread"}`}
              href={`/creators/${creator.username}`}
              key={creator.id}
            >
              <CreatorAvatar creator={creator} />
              <div>
                <p>
                  <strong>{creator.name}</strong>{" "}
                  {
                    [
                      "shared a little outfit inspiration.",
                      "has a new creative project to explore.",
                      "left a lovely little sketchbook update.",
                    ][index]
                  }
                </p>
                <small>Sample notification · Demo community</small>
              </div>
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          ))}
        <Link className="notification" href="/community-guidelines">
          <span className="account-avatar">
            <Heart size={19} aria-hidden="true" />
          </span>
          <div>
            <p>
              A gentle reminder: <strong>you belong here.</strong>
            </p>
            <small>Our community promise</small>
          </div>
          <Sparkles size={17} aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}
