"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ApiError, sendJson } from "@/lib/api-client";

import type { ChapterAnalysisStatus } from "../domain/analysis-status";
import { useAnalysisRunner } from "./use-analysis-runner";

interface AnalyzeChapterButtonProps {
  chapterId: string;
  status: ChapterAnalysisStatus;
  compact?: boolean;
}

const IN_PROGRESS: readonly ChapterAnalysisStatus[] = ["QUEUED", "ANALYZING"];

export function AnalyzeChapterButton({ chapterId, status, compact = false }: Readonly<AnalyzeChapterButtonProps>) {
  const { running, run } = useAnalysisRunner();
  const [confirming, setConfirming] = useState(false);
  const busy = running || IN_PROGRESS.includes(status);

  function analyze(force: boolean): void {
    setConfirming(false);
    void run(async () => {
      try {
        const { jobId } = await sendJson<{ jobId: string }>(`/api/chapters/${chapterId}/analyze`, "POST", { force });
        toast.info("Đã đưa chương vào hàng đợi phân tích.");
        return [jobId];
      } catch (error) {
        if (error instanceof ApiError && error.code === "ANALYSIS_UP_TO_DATE") {
          setConfirming(true);
          return [];
        }
        throw error;
      }
    });
  }

  return (
    <>
      <Button
        size={compact ? "sm" : "default"}
        variant={status === "ANALYZED" ? "outline" : "default"}
        disabled={busy}
        onClick={() => (status === "ANALYZED" ? setConfirming(true) : analyze(false))}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
        {busy ? "Đang phân tích…" : status === "ANALYZED" ? "Phân tích lại" : "Phân tích"}
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Phân tích lại chương này?</AlertDialogTitle>
            <AlertDialogDescription>
              Các bài học nháp do AI tạo trước đó từ chương này sẽ được lưu trữ và thay bằng bản mới. Bài học đã duyệt,
              bài học tạo thủ công và video hiện có không bị thay đổi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => analyze(true)}>Phân tích lại</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
