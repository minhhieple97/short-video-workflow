"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isTerminalJobStatus, type JobDto } from "@/shared/types/job";

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 8;

interface ApiErrorBody {
  error?: { message?: string };
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return body.error?.message ?? `Yêu cầu thất bại (HTTP ${response.status}).`;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function RunTestJobButton() {
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<JobDto | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function pollUntilDone(jobId: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && !signal.aborted; attempt += 1) {
      await wait(POLL_INTERVAL_MS, signal);
      if (signal.aborted) return;
      const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const latest = (await response.json()) as JobDto;
      setJob(latest);
      if (isTerminalJobStatus(latest.status)) {
        if (latest.status === "COMPLETED") toast.success("Worker đã xử lý tác vụ thử thành công.");
        else toast.error(latest.errorMessage ?? "Tác vụ thử không thành công.");
        return;
      }
    }
    if (!signal.aborted) toast.warning("Hết thời gian chờ. Worker có đang chạy không? (pnpm worker:dev)");
  }

  async function run(): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setJob(null);
    try {
      const response = await fetch("/api/diagnostics/test-job", { method: "POST", signal: controller.signal });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const { jobId } = (await response.json()) as { jobId: string };
      setJob({
        id: jobId,
        jobType: "DIAGNOSTIC_PING",
        status: "QUEUED",
        progress: 0,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      });
      await pollUntilDone(jobId, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(error instanceof Error ? error.message : "Không thể chạy tác vụ thử.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void run()} disabled={running}>
        {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Chạy tác vụ thử
      </Button>
      {job ? (
        <Badge variant={job.status === "FAILED" ? "destructive" : job.status === "COMPLETED" ? "default" : "secondary"}>
          {job.status} · {job.progress}%
        </Badge>
      ) : null}
    </div>
  );
}
