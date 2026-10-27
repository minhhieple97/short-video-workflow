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
