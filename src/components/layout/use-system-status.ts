"use client";

import { useEffect, useState } from "react";

import { apiRequest } from "@/lib/api-client";
import type { SystemStatusDto } from "@/shared/types/system-status";

const POLL_MS = 5_000;

// null until the first answer (or while the server cannot be reached); polls only while the tab is visible.
export function useSystemStatus(): SystemStatusDto | null {
  const [status, setStatus] = useState<SystemStatusDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState !== "visible") return;
      apiRequest<SystemStatusDto>("/api/status", { signal: controller.signal })
        .then(setStatus)
        .catch(() => {
          if (!controller.signal.aborted) setStatus(null);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return status;
}
