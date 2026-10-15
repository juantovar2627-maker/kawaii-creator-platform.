"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Check, ShieldCheck, X } from "lucide-react";
import {
  demoStateSchema,
  demoStorageKey,
  emptyDemoState,
  type DemoState,
} from "@/lib/demo/state";

type ListKey = "following" | "liked" | "saved" | "blocked";
type DemoContextValue = {
  state: DemoState;
  ready: boolean;
  toggle: (key: ListKey, id: string) => void;
  comment: (postId: string, text: string) => void;
  openReport: (target: string, trigger?: HTMLElement | null) => void;
  notify: (message: string) => void;
  markNotificationsRead: () => void;
  reset: () => void;
};
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(emptyDemoState);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const reportTrigger = useRef<HTMLElement | null>(null);
  const [reason, setReason] = useState("Unwanted or harmful content");
  const [details, setDetails] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(demoStorageKey);
      if (raw) {
        const result = demoStateSchema.safeParse(JSON.parse(raw));
        if (result.success) setState(result.data);
      }
    } catch {
      /* Storage may be unavailable; the in-memory demo still works. */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(demoStorageKey, JSON.stringify(state));
      } catch {
        /* Never block account functionality when demo storage is full. */
      }
    }
  }, [state, ready]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  function toggle(key: ListKey, id: string) {
    setState((previous) => ({
      ...previous,
      [key]: previous[key].includes(id)
        ? previous[key].filter((value) => value !== id)
        : [...previous[key], id].slice(-100),
    }));
  }

  function comment(postId: string, text: string) {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    setState((previous) => ({
      ...previous,
      comments: {
        ...previous.comments,
        [postId]: [
          ...(previous.comments[postId] || []),
          { id: crypto.randomUUID(), text: clean },
        ].slice(-30),
      },
    }));
    setToast("Comment added to this browser’s demo.");
  }

  return (
    <DemoContext.Provider
      value={{
        state,
        ready,
        toggle,
        comment,
        openReport: (target, trigger) => {
          reportTrigger.current = trigger || null;
          setReportTarget(target);
          setDetails("");
        },
        notify: setToast,
        markNotificationsRead: () =>
          setState((previous) => ({ ...previous, notificationsRead: true })),
        reset: () => {
          setState(emptyDemoState);
          setToast("Your local demo interactions have been reset.");
        },
      }}
    >
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toast && (
          <div className="mimi-toast">
            <Check size={18} aria-hidden="true" />
            {toast}
          </div>
        )}
      </div>
      <Dialog.Root
        open={reportTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReportTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="mimi-dialog"
            onCloseAutoFocus={(event) => {
              if (reportTrigger.current?.isConnected) {
                event.preventDefault();
                reportTrigger.current.focus();
              }
            }}
          >
            <span className="empty-flower">
              <ShieldCheck size={26} aria-hidden="true" />
            </span>
            <Dialog.Title>Make this space a little kinder</Dialog.Title>
            <Dialog.Description>
              This is a report preview for {reportTarget}. Your draft stays in
              this browser and is not sent to a moderation team.
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!reportTarget) return;
                setState((previous) => ({
                  ...previous,
                  reports: [
                    ...previous.reports,
                    { target: reportTarget, reason, details: details.trim() },
                  ].slice(-50),
                }));
                setReportTarget(null);
                setToast(
                  "Demo report draft saved locally. Nothing has been submitted.",
                );
              }}
            >
              <label htmlFor="report-reason">Reason</label>
              <select
                id="report-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option>Unwanted or harmful content</option>
                <option>Harassment or bullying</option>
                <option>Impersonation</option>
                <option>Spam</option>
                <option>Something else</option>
              </select>
              <label htmlFor="report-details">
                Anything else? <span className="muted">(optional)</span>
              </label>
              <textarea
                id="report-details"
                rows={3}
                maxLength={1000}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
              <button type="submit" className="mimi-button primary">
                Save demo report
              </button>
            </form>
            <Dialog.Close
              className="dialog-close icon-button"
              aria-label="Close report"
            >
              <X size={20} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("Community components need DemoProvider.");
  return context;
}
