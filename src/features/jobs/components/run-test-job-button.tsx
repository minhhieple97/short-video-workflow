"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";
import type { JobDto } from "@/shared/types/job";

import type { DiagnosticKind } from "../schemas/job-payload.schema";

import { waitForJob } from "./wait-for-job";

interface RunTestJobButtonProps {
  kind?: DiagnosticKind;
  label?: string;
  successMessage?: string;
  // Polls every 2 s; a check that starts an external tool needs longer than a ping.
  maxAttempts?: number;
  // Re-renders the page once the job settles, for a check whose result the page shows.
  refreshWhenDone?: boolean;
}

export function RunTestJobButton({
  kind = "ping",
  label = "Chạy tác vụ thử",
  successMessage = "Worker đã xử lý tác vụ thử thành công.",
  maxAttempts = 8,
  refreshWhenDone = false,
}: Readonly<RunTestJobButtonProps>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<Pick<JobDto, "status" | "progress"> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const { jobId } = await sendJson<{ jobId: string }>("/api/diagnostics/test-job", "POST", { kind });
      setJob({ status: "QUEUED", progress: 0 });
      const settled = await waitForJob(jobId, { signal: controller.signal, maxAttempts, onUpdate: setJob });
      if (controller.signal.aborted) return;
      if (settled && refreshWhenDone) router.refresh();
      if (!settled) toast.warning("Hết thời gian chờ. Worker có đang chạy không? (pnpm worker:dev)");
      else if (settled.status === "COMPLETED") toast.success(successMessage);
      else toast.error(settled.errorMessage ?? "Tác vụ thử không thành công.");
    } catch (error) {
      if (!controller.signal.aborted) toast.error(errorMessage(error, "Không thể chạy tác vụ thử."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void run()} disabled={running}>
        {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {label}
      </Button>
      {job ? (
        <Badge variant={job.status === "FAILED" ? "rose" : job.status === "COMPLETED" ? "mint" : "violet"}>
          {job.status} · {job.progress}%
        </Badge>
      ) : null}
    </div>
  );
}
