"use client";
import { reportReasons } from "@/lib/moderation/validation";
import { useSocialAction } from "./actions";
import { SocialFeedback } from "./primitives";
export function ContentReport({
  target,
  id,
}: {
  target: "post" | "comment";
  id: number;
}) {
  const action = useSocialAction();
  return (
    <details className="social-report">
      <summary>Report {target}</summary>
      <form
        className="studio-form safety-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.send({
            action: "report",
            target,
            id,
            reason: form.get("reason"),
            explanation: form.get("explanation"),
          });
        }}
      >
        <label htmlFor={`reason-${target}-${id}`}>
          Reason for reporting this {target}
        </label>
        <select name="reason" id={`reason-${target}-${id}`}>
          {reportReasons.map((reason) => (
            <option key={reason}>{reason}</option>
          ))}
        </select>
        <label htmlFor={`explain-${target}-${id}`}>
          Optional report explanation
        </label>
        <textarea
          rows={3}
          maxLength={1000}
          name="explanation"
          id={`explain-${target}-${id}`}
        />
        <button className="mimi-button secondary small" disabled={action.busy}>
          Submit {target} report
        </button>
      </form>
      <SocialFeedback message={action.message} error={action.error} />
    </details>
  );
}
