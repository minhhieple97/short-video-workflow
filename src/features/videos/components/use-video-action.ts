"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { waitForJob } from "@/features/jobs/components/wait-for-job";
import { errorMessage } from "@/lib/api-client";
import { aiRunCommand } from "@/shared/types/job";

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

  // Waiting for Claude Code or a long job is not a failure: tell the user and refresh so server state takes over.
  async function runJob(enqueue: () => Promise<{ jobId: string }>, success: string): Promise<void> {
    setPending(true);
    try {
      const { jobId } = await enqueue();
      toast.info("Đã đưa vào hàng đợi. Worker đang xử lý…");
      const job = await waitForJob(jobId);
      if (!job) {
        toast.info("Tác vụ vẫn đang chạy nền. Trang sẽ cập nhật khi xong.");
      } else if (job.status === "WAITING_FOR_CLI") {
        toast.info("Đang chờ bạn chạy Claude Code. Chạy lệnh này trong terminal WSL:", {
          description: aiRunCommand(job.id),
          duration: 30_000,
        });
      } else if (job.status === "COMPLETED") {
        toast.success(success);
      } else {
        throw new Error(job.errorMessage ?? "Tác vụ thất bại.");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  return { pending, run, runJob };
}
