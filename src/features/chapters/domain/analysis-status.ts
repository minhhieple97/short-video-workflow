export const CHAPTER_ANALYSIS_STATUSES = ["NOT_ANALYZED", "QUEUED", "ANALYZING", "ANALYZED", "FAILED"] as const;
export type ChapterAnalysisStatus = (typeof CHAPTER_ANALYSIS_STATUSES)[number];

export const CHAPTER_ANALYSIS_STATUS_LABELS: Record<ChapterAnalysisStatus, string> = {
  NOT_ANALYZED: "Chưa phân tích",
  QUEUED: "Đang chờ",
  ANALYZING: "Đang phân tích",
  ANALYZED: "Đã phân tích",
  FAILED: "Lỗi phân tích",
};

export function toChapterAnalysisStatus(value: string): ChapterAnalysisStatus {
  return CHAPTER_ANALYSIS_STATUSES.find((status) => status === value) ?? "NOT_ANALYZED";
}
