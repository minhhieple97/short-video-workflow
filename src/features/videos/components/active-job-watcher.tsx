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

interface ActiveJobWatcherProps {
  job: JobDto;
  sceneNumber: number | null;
  lockedNote: string;
}

// Shown while a script job queued earlier (possibly from another tab) is unfinished: the whole script, or one scene when
// `sceneNumber` is set. It follows the job through WAITING_FOR_CLI (the user runs the command) until it really settles,
// then refreshes the page.
export function ActiveJobWatcher({ job: initial, sceneNumber, lockedNote }: Readonly<ActiveJobWatcherProps>) {
  const router = useRouter();
  const rewriting = sceneNumber !== null;
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
      toast.success(rewriting ? "Đã huỷ viết lại cảnh." : "Đã huỷ tạo kịch bản.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

  const waiting = job.status === "WAITING_FOR_CLI";
  const stopping = job.status === "CANCEL_REQUESTED";
  const runningLabel = rewriting ? `Worker đang viết lại cảnh ${sceneNumber}…` : "Worker đang tạo kịch bản…";

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          {waiting ? (
            <Terminal className="size-4" aria-hidden />
          ) : (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          )}
          {waiting ? "Đang chờ bạn chạy Claude Code" : stopping ? "Đang huỷ…" : runningLabel}
        </p>
        {stopping ? null : (
          <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancel()}>
            <X aria-hidden />
            {rewriting ? "Huỷ viết lại cảnh" : "Huỷ tạo kịch bản"}
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
      <p className="text-muted-foreground">{lockedNote}</p>
    </div>
  );
}
