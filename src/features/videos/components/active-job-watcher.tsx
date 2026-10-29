"use client";

import { Loader2, Terminal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { errorMessage, sendJson } from "@/lib/api-client";
import { aiRunCommand, type JobDto } from "@/shared/types/job";

const POLL_MS = 3_000;
const MAX_POLLS = 1_200;

export interface ActiveJobLabels {
  running: string;
  cancel: string;
  cancelled: string;
}

interface ActiveJobWatcherProps {
  job: JobDto;
  labels: ActiveJobLabels;
  // What stays locked until the job settles, if anything.
  note?: string;
}

// Shown while an AI job for this video queued earlier (possibly from another tab) is unfinished. It follows the job
// through WAITING_FOR_CLI (the user runs the command) until it really settles, then refreshes the page.
export function ActiveJobWatcher({ job: initial, labels, note }: Readonly<ActiveJobWatcherProps>) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const [cancelling, setCancelling] = useState(false);

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

  async function cancel(): Promise<void> {
    setCancelling(true);
    try {
      setJob(await sendJson<JobDto>(`/api/jobs/${job.id}/cancel`, "POST"));
      toast.success(labels.cancelled);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

  const waiting = job.status === "WAITING_FOR_CLI";
  const stopping = job.status === "CANCEL_REQUESTED";

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          {waiting ? (
            <Terminal className="size-4" aria-hidden />
          ) : (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          )}
          {waiting ? "Đang chờ bạn chạy Claude Code" : stopping ? "Đang huỷ…" : labels.running}
        </p>
        {stopping ? null : (
          <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancel()}>
            <X aria-hidden />
            {labels.cancel}
          </Button>
        )}
      </div>
      {waiting ? (
        <>
          <p className="text-muted-foreground">
            Worker đã chuẩn bị xong. Chạy lệnh sau trong terminal WSL (thư mục dự án); trang sẽ tự cập nhật khi xong:
          </p>
          <code className="bg-muted w-fit rounded px-2 py-1 text-xs break-all">{aiRunCommand(job.id)}</code>
        </>
      ) : null}
      {note ? <p className="text-muted-foreground">{note}</p> : null}
    </div>
  );
}
