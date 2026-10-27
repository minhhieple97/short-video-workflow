"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { errorMessage } from "@/lib/api-client";

// Wraps a mutation (or a queued job) with pending state, error toasts and a server refresh.
export function useVideoAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    setPending(true);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function runJob(enqueue: () => Promise<{ jobId: string }>, success: string): Promise<void> {
    await run(async () => {
      const { jobId } = await enqueue();
      toast.info("Đã đưa vào hàng đợi. Worker đang xử lý…");
      const job = await waitForJob(jobId);
      if (!job) throw new Error("Tác vụ vẫn đang chạy nền. Tải lại trang sau ít phút.");
      if (job.status === "WAITING_FOR_CLI")
        throw new Error("Tác vụ đang chờ bạn chạy lệnh Claude Code trong terminal.");
      if (job.status !== "COMPLETED") throw new Error(job.errorMessage ?? "Tác vụ thất bại.");
    }, success);
  }

  return { pending, run, runJob };
}
