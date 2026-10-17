// Deliberately narrow schema: no arbitrary Error, request, headers, URL or body.
export function operationalLog(
  event:
    | "cleanup_started"
    | "cleanup_succeeded"
    | "cleanup_failed"
    | "worker_result"
    | "worker_failed",
  fields: {
    durationMs?: number;
    jobClaimed?: boolean;
    state?: "idle" | "queued" | "succeeded" | "failed" | "cancelled";
  } = {},
) {
  console.info(
    JSON.stringify({ time: new Date().toISOString(), event, ...fields }),
  );
}
