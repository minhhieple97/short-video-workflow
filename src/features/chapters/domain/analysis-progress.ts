import type { ChapterAnalysisStatus } from "./analysis-status";

export interface AnalysisProgress {
  total: number;
  analyzed: number;
  partial: number;
  failed: number;
  queued: number;
  analyzing: number;
  waitingForCli: number;
  notAnalyzed: number;
}

// What the "analyse every chapter" control needs to know about a book, as the server sees it.
export interface BookAnalysisOverview extends AnalysisProgress {
  // Chapters a click would queue: not up to date and not already queued or running.
  needsAnalysis: number;
  // Shown as analysed but made with another AI mode or prompt version, so a click analyses them again.
  outdated: number;
  // The chapter the worker is on, for the progress line.
  currentChapter: string | null;
}

const COUNTED: Record<ChapterAnalysisStatus, keyof Omit<AnalysisProgress, "total">> = {
  NOT_ANALYZED: "notAnalyzed",
  QUEUED: "queued",
  ANALYZING: "analyzing",
  WAITING_FOR_CLI: "waitingForCli",
  ANALYZED: "analyzed",
  PARTIAL: "partial",
  FAILED: "failed",
};

export function countAnalysisProgress(statuses: readonly ChapterAnalysisStatus[]): AnalysisProgress {
  const progress: AnalysisProgress = {
    total: statuses.length,
    analyzed: 0,
    partial: 0,
    failed: 0,
    queued: 0,
    analyzing: 0,
    waitingForCli: 0,
    notAnalyzed: 0,
  };
  for (const status of statuses) progress[COUNTED[status]] += 1;
  return progress;
}

// The worker is busy with this book: the page keeps following it until nothing is queued or running.
export function isAnalysisRunning(progress: AnalysisProgress): boolean {
  return progress.queued + progress.analyzing > 0;
}

export interface AnalyzeAllAction {
  enabled: boolean;
  busy: boolean;
  label: string;
  // Why the button cannot be used, or what a click will do that the user might not expect.
  note: string | null;
}

// Where a PDF book's extraction is, when it has not produced chapters yet: still going, or stopped and waiting on the user.
export type PendingExtraction = "running" | "stopped" | null;

const NO_CHAPTERS_NOTE: Record<"running" | "stopped" | "none", string> = {
  running: "Đang trích xuất PDF; chương sẽ xuất hiện khi trích xuất xong.",
  stopped: "Trích xuất PDF đang dừng nên chưa có chương. Xem thẻ “Trích xuất PDF” phía trên.",
  none: "Sách chưa có chương để phân tích. Với PDF, hãy hoàn tất trích xuất và tạo chương trước.",
};

// Decides what the "analyse every chapter" button says and whether it can be pressed, so it is never clickable when a
// click would do nothing and never looks idle while the worker is still on the book.
export function analyzeAllAction(overview: BookAnalysisOverview, extraction: PendingExtraction): AnalyzeAllAction {
  if (overview.total === 0) {
    return {
      enabled: false,
      busy: false,
      label: "Phân tích tất cả chương",
      note: NO_CHAPTERS_NOTE[extraction ?? "none"],
    };
  }
  if (isAnalysisRunning(overview)) {
    const left = overview.queued + overview.analyzing;
    return { enabled: false, busy: true, label: `Đang phân tích · còn ${left} chương`, note: null };
  }
  if (overview.needsAnalysis === 0) {
    return {
      enabled: false,
      busy: false,
      label: overview.waitingForCli > 0 ? "Đang chờ Claude Code" : "Đã phân tích tất cả chương",
      note:
        overview.waitingForCli > 0
          ? `${overview.waitingForCli} chương đang chờ bạn chạy lệnh Claude Code (xem trang Tác vụ).`
          : "Dùng “Phân tích lại” trên từng chương nếu muốn chạy lại.",
    };
  }
  return {
    enabled: true,
    busy: false,
    label:
      overview.needsAnalysis === overview.total
        ? "Phân tích tất cả chương"
        : `Phân tích ${overview.needsAnalysis} chương còn lại`,
    note:
      overview.outdated > 0
        ? `${overview.outdated} chương đã phân tích bằng chế độ AI hoặc prompt cũ sẽ được phân tích lại.`
        : null,
  };
}
