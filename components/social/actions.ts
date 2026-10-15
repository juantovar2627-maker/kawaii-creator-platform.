"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { safetyRequest } from "@/components/safety/request";
export function useSocialAction(admin = false) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await safetyRequest(
        admin ? "/api/admin/social" : "/api/social",
        body,
      );
      setMessage(result.message);
      await mutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("/api/social") ||
            key.startsWith("/api/safety") ||
            key.startsWith("/api/admin/social")),
      );
      return result;
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, message, send };
}
