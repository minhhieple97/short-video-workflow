export const VIDEO_STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  DRAFT: "Chưa có kịch bản",
  NEEDS_REVIEW: "Kịch bản cần duyệt",
  APPROVED: "Kịch bản đã duyệt",
};

export function toVideoStatus(value: string): VideoStatus {
  return VIDEO_STATUSES.find((status) => status === value) ?? "DRAFT";
}
