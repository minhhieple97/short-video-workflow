"use client";

import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { sendJson } from "@/lib/api-client";

import { useAnalysisRunner } from "./use-analysis-runner";

interface BookAnalysisResponse {
  jobs: { jobId: string }[];
  skipped: number;
}

export function AnalyzeBookButton({ bookId }: Readonly<{ bookId: string }>) {
  const { running, run } = useAnalysisRunner();

  function analyzeAll(): void {
    void run(async () => {
      const { jobs, skipped } = await sendJson<BookAnalysisResponse>(`/api/books/${bookId}/analyze`, "POST");
      if (jobs.length === 0)
        toast.info("Tất cả chương đã được phân tích. Dùng “Phân tích lại” trên từng chương nếu cần.");
      else
        toast.info(
          `Đã xếp ${jobs.length} chương vào hàng đợi${skipped ? `, bỏ qua ${skipped} chương đã phân tích` : ""}.`,
        );
      return jobs.map((job) => job.jobId);
    });
  }

  return (
    <Button onClick={analyzeAll} disabled={running}>
      {running ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
      {running ? "Đang phân tích…" : "Phân tích tất cả chương"}
    </Button>
  );
}
