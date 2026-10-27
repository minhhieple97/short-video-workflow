export const JOB_TYPES = [
  "DIAGNOSTIC_PING",
  "ANALYZE_CHAPTER",
  "GENERATE_VIDEO_SCRIPT",
  "GENERATE_SCENE_TTS",
  "RENDER_VIDEO",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "QUEUED",
  "WAITING_FOR_CLI",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isJobType(value: string): value is JobType {
  return JOB_TYPES.some((type) => type === value);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export interface JobDto {
  id: string;
  jobType: string;
  status: JobStatus;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  DIAGNOSTIC_PING: "Kiểm tra hệ thống",
  ANALYZE_CHAPTER: "Phân tích chương",
  GENERATE_VIDEO_SCRIPT: "Tạo kịch bản",
  GENERATE_SCENE_TTS: "Tạo giọng đọc",
  RENDER_VIDEO: "Render video",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: "Đang chờ",
  WAITING_FOR_CLI: "Chờ Claude CLI",
  RUNNING: "Đang chạy",
  COMPLETED: "Hoàn tất",
  FAILED: "Lỗi",
  CANCEL_REQUESTED: "Đang huỷ",
  CANCELLED: "Đã huỷ",
};

export interface JobListItem extends JobDto {
  entityLabel: string;
  entityHref: string | null;
  attempts: number;
  cliCommand: string | null;
  canRetry: boolean;
  canCancel: boolean;
}
