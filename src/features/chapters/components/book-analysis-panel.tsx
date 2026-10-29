"use client";

import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { SegmentedProgress } from "@/components/layout/segmented-progress";
import { Button } from "@/components/ui/button";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import { errorMessage, sendJson } from "@/lib/api-client";

import {
  analyzeAllAction,
  isAnalysisRunning,
  type BookAnalysisOverview,
  type PendingExtraction,
} from "../domain/analysis-progress";

interface BookAnalysisResponse {
  jobs: { jobId: string }[];
  skipped: number;
}

// Tells the user once, when a run they started here is over.
function useRunFinishedToast(overview: BookAnalysisOverview) {
  const running = isAnalysisRunning(overview);
  const startedHereRef = useRef(false);
  const wasRunningRef = useRef(running);
  useEffect(() => {
    if (wasRunningRef.current && !running && startedHereRef.current) {
      startedHereRef.current = false;
      if (overview.failed > 0) toast.warning(`Phân tích xong, ${overview.failed} chương lỗi. Xem cột “Phân tích”.`);
      else toast.success("Phân tích xong. Bài học nháp đã sẵn sàng để duyệt ở tab Bài học.");
    }
    wasRunningRef.current = running;
  }, [running, overview.failed]);
  return startedHereRef;
}

// The chapters tab's header: what the AI will do, how far it has got (from the server, so a reload shows the same
// thing), and a button that is only clickable when a click would actually queue something.
export function BookAnalysisPanel({
  bookId,
  aiMode,
  overview,
  extraction,
}: Readonly<{ bookId: string; aiMode: string; overview: BookAnalysisOverview; extraction: PendingExtraction }>) {
  const router = useRouter();
  const noteId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const startedHereRef = useRunFinishedToast(overview);
  const running = isAnalysisRunning(overview);
  const action = analyzeAllAction(overview, extraction);
  const busy = action.busy || submitting || refreshing;

  async function analyzeAll(): Promise<void> {
    setSubmitting(true);
    try {
      const { jobs, skipped } = await sendJson<BookAnalysisResponse>(`/api/books/${bookId}/analyze`, "POST");
      if (jobs.length === 0) {
        toast.info("Không còn chương nào cần phân tích.");
      } else {
        startedHereRef.current = true;
        toast.info(
          `Đã xếp ${jobs.length} chương vào hàng đợi${skipped ? `, bỏ qua ${skipped} chương đã phân tích` : ""}. Tiến độ tự cập nhật bên dưới.`,
        );
      }
      // Kept busy until the page shows the queued chapters, so the button cannot be pressed twice in between.
      startRefresh(() => router.refresh());
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const done = !action.enabled && !busy && overview.total > 0 && overview.needsAnalysis === 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground max-w-xl text-sm">
          Chế độ AI: <span className="text-foreground font-medium">{aiMode}</span> · phân tích lần lượt từng chương, bài
          học tạo ra ở trạng thái nháp.
        </p>
        <div className="flex max-w-sm flex-col items-end gap-1">
          <Button
            onClick={() => void analyzeAll()}
            disabled={!action.enabled || busy}
            aria-busy={busy}
            aria-describedby={action.note ? noteId : undefined}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : done ? (
              <CheckCircle2 aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            {submitting ? "Đang xếp hàng…" : action.label}
          </Button>
          {action.note ? (
            <p id={noteId} className="text-muted-foreground text-right text-xs">
              {action.note}
            </p>
          ) : null}
        </div>
      </div>

      {overview.total > 0 ? (
        <SegmentedProgress
          label="Tiến độ phân tích"
          summary={`${overview.analyzed}/${overview.total} chương đã phân tích`}
          done={overview.analyzed}
          total={overview.total}
          segments={[
            { key: "analyzed", label: "Đã phân tích", value: overview.analyzed, tone: "mint" },
            { key: "partial", label: "Phân tích chưa hết", value: overview.partial, tone: "amber" },
            { key: "failed", label: "Lỗi", value: overview.failed, tone: "rose" },
            { key: "analyzing", label: "Đang phân tích", value: overview.analyzing, tone: "violet", active: true },
            { key: "queued", label: "Đang chờ", value: overview.queued, tone: "violet" },
            { key: "cli", label: "Chờ Claude CLI", value: overview.waitingForCli, tone: "blue" },
            { key: "todo", label: "Chưa phân tích", value: overview.notAnalyzed, tone: "slate" },
          ]}
        />
      ) : null}

      {running ? (
        <p className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
          {overview.currentChapter
            ? `Đang phân tích: ${overview.currentChapter}`
            : "Đang chờ worker nhận chương tiếp theo…"}
          <span className="text-muted-foreground">· trang tự cập nhật, bạn có thể rời trang.</span>
        </p>
      ) : null}
      <JobsAutoRefresh active={running || overview.waitingForCli > 0} />
    </div>
  );
}
