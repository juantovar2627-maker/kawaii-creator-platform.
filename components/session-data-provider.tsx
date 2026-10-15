"use client";
import { useState } from "react";
import { SWRConfig } from "swr";

// The server keys this provider by the verified account. A session change gets
// a fresh client cache and component state, including private drafts and saves.
export function SessionDataProvider({
  fallback,
  children,
}: {
  fallback: Record<string, unknown>;
  children: React.ReactNode;
}) {
  const [cache] = useState(() => new Map());
  return (
    <SWRConfig value={{ provider: () => cache, fallback }}>
      {children}
    </SWRConfig>
  );
}
