export const CHAPTER_ANALYSIS_STATUSES = [
  "NOT_ANALYZED",
  "QUEUED",
  "ANALYZING",
  "WAITING_FOR_CLI",
  "ANALYZED",
  // Lessons were found, but the reader stopped before the end of at least one part: never presented as complete.
  "PARTIAL",
  "FAILED",
] as const;
export type ChapterAnalysisStatus = (typeof CHAPTER_ANALYSIS_STATUSES)[number];

export const CHAPTER_ANALYSIS_STATUS_LABELS: Record<ChapterAnalysisStatus, string> = {
  NOT_ANALYZED: "Chưa phân tích",
  QUEUED: "Đang chờ",
  ANALYZING: "Đang phân tích",
  WAITING_FOR_CLI: "Chờ chạy Claude CLI",
  ANALYZED: "Đã phân tích",
  PARTIAL: "Phân tích chưa hết",
  FAILED: "Lỗi phân tích",
};

export function toChapterAnalysisStatus(value: string): ChapterAnalysisStatus {
  return CHAPTER_ANALYSIS_STATUSES.find((status) => status === value) ?? "NOT_ANALYZED";
}

// Avoids "Chương 1: Chương 1: …" when the stored title already carries its own marker.
export function chapterLabel(order: number, title: string): string {
  return /^(chương|chuong|chapter|phần|phan|part|hồi)\s/iu.test(title) ? title : `Chương ${order}: ${title}`;
}

const IN_PROGRESS_STATUSES: readonly ChapterAnalysisStatus[] = ["QUEUED", "ANALYZING", "WAITING_FOR_CLI"];

export function isAnalysisInProgress(status: ChapterAnalysisStatus): boolean {
  return IN_PROGRESS_STATUSES.includes(status);
}

// Why a chapter's checkbox is off: it is already in the queue, or it is up to date and only "Phân tích lại" runs it again.
export function selectionBlockedNote(status: ChapterAnalysisStatus): string {
  return isAnalysisInProgress(status)
    ? "Chương đang trong hàng đợi phân tích."
    : "Chương đã phân tích. Dùng nút “Phân tích lại” ở cuối dòng nếu muốn chạy lại.";
}
