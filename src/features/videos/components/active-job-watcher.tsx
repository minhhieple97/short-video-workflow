"use client";

import { Loader2, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { aiRunCommand, type JobDto } from "@/shared/types/job";

const POLL_MS = 3_000;
const MAX_POLLS = 1_200;

interface ActiveJobWatcherProps {
  job: JobDto;
  runningLabel: string;
}

// Shown while a job queued earlier (possibly from another tab) is unfinished. It follows the job through
// WAITING_FOR_CLI (the user runs the command) until it really settles, then refreshes the page.
export function ActiveJobWatcher({ job: initial, runningLabel }: Readonly<ActiveJobWatcherProps>) {
  const router = useRouter();
  const [job, setJob] = useState(initial);

  useEffect(() => {
    const controller = new AbortController();
    void waitForJob(initial.id, {
      signal: controller.signal,
      intervalMs: POLL_MS,
      maxAttempts: MAX_POLLS,
      keepWaitingForCli: true,
      onUpdate: setJob,
    })
      .then((settled) => {
        if (!settled || controller.signal.aborted) return;
        if (settled.status === "FAILED") toast.error(settled.errorMessage ?? "Tác vụ thất bại.");
        router.refresh();
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [initial.id, router]);

  if (job.status === "WAITING_FOR_CLI") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" role="status">
        <p className="flex items-center gap-2 font-medium">
          <Terminal className="size-4" aria-hidden />
          Đang chờ bạn chạy Claude Code
        </p>
        <p className="text-muted-foreground">
          Worker đã chuẩn bị xong. Chạy lệnh sau trong terminal WSL (thư mục dự án); trang sẽ tự cập nhật khi xong:
        </p>
        <code className="bg-muted w-fit rounded px-2 py-1 text-xs break-all">{aiRunCommand(job.id)}</code>
      </div>
    );
  }

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {runningLabel}
    </p>
  );
}
