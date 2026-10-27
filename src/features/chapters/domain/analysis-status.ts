export const CHAPTER_ANALYSIS_STATUSES = [
  "NOT_ANALYZED",
  "QUEUED",
  "ANALYZING",
  "WAITING_FOR_CLI",
  "ANALYZED",
  "FAILED",
] as const;
export type ChapterAnalysisStatus = (typeof CHAPTER_ANALYSIS_STATUSES)[number];

export const CHAPTER_ANALYSIS_STATUS_LABELS: Record<ChapterAnalysisStatus, string> = {
  NOT_ANALYZED: "Chưa phân tích",
  QUEUED: "Đang chờ",
  ANALYZING: "Đang phân tích",
  WAITING_FOR_CLI: "Chờ chạy Claude CLI",
  ANALYZED: "Đã phân tích",
  FAILED: "Lỗi phân tích",
};

export function toChapterAnalysisStatus(value: string): ChapterAnalysisStatus {
  return CHAPTER_ANALYSIS_STATUSES.find((status) => status === value) ?? "NOT_ANALYZED";
}

// Avoids "Chương 1: Chương 1: …" when the stored title already carries its own marker.
export function chapterLabel(order: number, title: string): string {
  return /^(chương|chuong|chapter|phần|phan|part|hồi)\s/iu.test(title) ? title : `Chương ${order}: ${title}`;
}
