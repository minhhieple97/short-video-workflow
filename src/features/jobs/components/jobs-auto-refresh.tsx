"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 3_000;

// Polling is enough for a single local user; no WebSocket/SSE needed.
export function JobsAutoRefresh({ active }: Readonly<{ active: boolean }>) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
