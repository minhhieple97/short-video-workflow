"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { waitForJob } from "@/features/jobs/components/wait-for-job";

// Shown while a script job queued earlier (possibly from another tab) is still running; refreshes the page when it settles.
export function ActiveJobWatcher({ jobId, label }: Readonly<{ jobId: string; label: string }>) {
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    void waitForJob(jobId, { signal: controller.signal })
      .then((job) => {
        if (job && !controller.signal.aborted) router.refresh();
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [jobId, router]);

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </p>
  );
}
