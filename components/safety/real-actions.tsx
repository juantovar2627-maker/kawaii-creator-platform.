"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { reportReasons } from "@/lib/moderation/validation";
import { safetyRequest } from "./request";

export function RealSafetyActions({ username }: { username: string }) {
  const { data: user } = useSWR("/api/user");
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(body: unknown, block = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await safetyRequest("/api/safety", body);
      setMessage(result.message);
      if (block) {
        await mutate(
          (key) => typeof key === "string" && key.startsWith("/api/social"),
        );
        router.push("/dashboard/safety");
        router.refresh();
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <p className="creator-help">
        <Link className="text-link" href="/sign-in">
          Sign in to report or block a real creator
        </Link>
      </p>
    );
  return (
    <section
      className="real-safety account-panel"
      aria-label="Creator safety tools"
    >
      <h2>Keep your corner kind.</h2>
      <p>
        Reports go to Mimi’s moderation queue. Blocking hides this account from
        your signed-in discovery and creator pages. Public information can still
        be viewed anonymously.
      </p>
      <details>
        <summary>Report this real creator</summary>
        <form
          className="studio-form safety-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void send({
              action: "report",
              username,
              reason: form.get("reason"),
              explanation: form.get("explanation"),
            });
          }}
        >
          <label htmlFor="real-report-reason">Report reason</label>
          <select id="real-report-reason" name="reason">
            {reportReasons.map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
          </select>
          <label htmlFor="real-report-explanation">Optional explanation</label>
          <textarea
            id="real-report-explanation"
            name="explanation"
            maxLength={1000}
            rows={3}
            placeholder="Tell us what happened. Avoid sharing unnecessary private information."
          />
          <button className="mimi-button primary" disabled={busy}>
            Submit real report
          </button>
        </form>
      </details>
      <details>
        <summary>Block this account</summary>
        <p>
          This is saved to your account across devices. You can unblock from
          Community Safety.
        </p>
        <button
          type="button"
          className="mimi-button secondary"
          disabled={busy}
          onClick={() => void send({ action: "block", username }, true)}
        >
          Confirm block
        </button>
      </details>
      {message && (
        <p className="creator-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="creator-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
