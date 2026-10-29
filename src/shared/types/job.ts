export const JOB_TYPES = [
  "DIAGNOSTIC_PING",
  "ANALYZE_CHAPTER",
  "GENERATE_VIDEO_SCRIPT",
  "GENERATE_PUBLISH_METADATA",
  "GENERATE_SCENE_TTS",
  "RENDER_VIDEO",
  "RUN_PRODUCTION_ITEM",
  "ARCHIVE_RENDER",
  "EXTRACT_PDF",
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
export const ACTIVE_JOB_STATUSES = ["QUEUED", "WAITING_FOR_CLI", "RUNNING", "CANCEL_REQUESTED"] as const;

export function isJobType(value: string): value is JobType {
  return JOB_TYPES.some((type) => type === value);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function aiRunCommand(jobId: string): string {
  return `pnpm ai:run --job ${jobId}`;
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.some((active) => active === status);
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
  GENERATE_PUBLISH_METADATA: "Tạo tiêu đề & caption",
  GENERATE_SCENE_TTS: "Tạo giọng đọc",
  RENDER_VIDEO: "Render video",
  RUN_PRODUCTION_ITEM: "Sản xuất video",
  ARCHIVE_RENDER: "Lưu lên Google Drive",
  EXTRACT_PDF: "Trích xuất PDF",
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
