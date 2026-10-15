"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  PenLine,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useDemo } from "./demo-provider";
import { creators } from "@/lib/demo/community";
import { DemoNotice } from "./primitives";

export function PersonalDashboard() {
  const { data: user } = useSWR("/api/user", (url) =>
    fetch(url).then((response) => response.json()),
  );
  const { state, toggle, reset } = useDemo();
  return (
    <>
      <section className="account-welcome">
        <div>
          <p className="eyebrow">
            <Sparkles size={13} aria-hidden="true" />
            YOUR OWN LITTLE CORNER
          </p>
          <h1>Hello, {user?.name?.split(" ")[0] || "lovely human"}.</h1>
          <p>Make yourself at home. There’s room to grow at your own pace.</p>
        </div>
        <span className="account-avatar" aria-hidden="true">
          {(user?.name || user?.email || "♡").slice(0, 1).toUpperCase()}
        </span>
      </section>
      <div className="account-stat-grid">
        <Link className="account-stat" href="/following">
          <Heart size={20} aria-hidden="true" />
          <strong>{state.following.length}</strong>
          <span>Demo creators followed</span>
        </Link>
        <Link className="account-stat" href="/dashboard/saved">
          <Bookmark size={20} aria-hidden="true" />
          <strong>{state.saved.length}</strong>
          <span>Demo posts saved</span>
        </Link>
        <div className="account-stat">
          <ShieldCheck size={20} aria-hidden="true" />
          <strong>{state.reports.length}</strong>
          <span>Local report drafts</span>
        </div>
      </div>
      <DemoNotice>
        Your account and profile settings use the real database. Community
        interactions and the numbers above are demo activity stored only in this
        browser.
      </DemoNotice>
      <div className="account-tool-grid">
        <div className="account-tool">
          <PenLine size={25} aria-hidden="true" />
          <div>
            <h2>A little more you.</h2>
            <p>
              Update your real display name and email. Keep your account feeling
              like home.
            </p>
            <Link href="/dashboard/general" className="text-link">
              Edit your profile
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="account-tool">
          <Sparkles size={25} aria-hidden="true" />
          <div>
            <h2>Something lovely starts here.</h2>
            <p>
              Make a browser-local post draft in your creator studio. Publishing
              will come later.
            </p>
            <Link href="/dashboard/creator-tools" className="text-link">
              Open creator studio
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
      <section className="account-panel mt-6">
        <h2>Keep your corner kind.</h2>
        <p>
          Blocking hides fictional creators’ content in this browser. Report
          drafts are saved locally and have not been submitted to a moderation
          team.
        </p>
        <div className="account-blocked">
          {creators
            .filter((creator) => state.blocked.includes(creator.id))
            .map((creator) => (
              <button
                key={creator.id}
                className="mimi-button secondary small"
                onClick={() => toggle("blocked", creator.id)}
              >
                Unblock {creator.name}
              </button>
            ))}
          {!state.blocked.length && (
            <span className="muted text-xs">No demo creators blocked.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <Link href="/community-guidelines" className="text-link">
            Our community promise
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <button className="text-link" onClick={reset}>
            Reset local demo activity
          </button>
        </div>
      </section>
    </>
  );
}
