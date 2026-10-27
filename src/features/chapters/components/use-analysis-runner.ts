"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { errorMessage } from "@/lib/api-client";
import type { JobDto } from "@/shared/types/job";

function reportSettled(job: JobDto | null): void {
  if (!job) toast.info("Phân tích vẫn đang chạy nền. Tải lại trang sau ít phút.");
  else if (job.status === "COMPLETED") toast.success("Phân tích xong. Bài học nháp đã sẵn sàng để duyệt.");
  else if (job.status === "WAITING_FOR_CLI") toast.info("Tác vụ đang chờ bạn chạy lệnh Claude Code trong terminal.");
  else toast.error(job.errorMessage ?? "Phân tích thất bại.");
}

// Runs an enqueue request, then follows each returned job in order and refreshes the page as they finish.
export function useAnalysisRunner() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(enqueue: () => Promise<string[]>): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const jobIds = await enqueue();
      router.refresh();
      for (const jobId of jobIds) {
        const settled = await waitForJob(jobId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        router.refresh();
        if (jobIds.length === 1 || settled?.status !== "COMPLETED") reportSettled(settled);
      }
      if (jobIds.length > 1) toast.success(`Đã phân tích xong ${jobIds.length} chương.`);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return { running, run };
}
