import { isActiveJobStatus, type JobStatus } from "@/shared/types/job";

import type { SceneVoiceJobDto } from "../schemas/video.dto";

export type SceneVoiceJobs = Readonly<Record<string, SceneVoiceJobDto>>;

// The scene's voice job while it has not finished: the scene is already in the queue, so asking again would only repeat
// the request. A failed job is not active.
export function activeVoiceJob(job: SceneVoiceJobDto | undefined): SceneVoiceJobDto | null {
  return job !== undefined && isActiveJobStatus(job.status) ? job : null;
}

const VOICE_JOB_LABELS: Partial<Record<JobStatus, string>> = {
  QUEUED: "Đang chờ trong hàng đợi",
  WAITING_FOR_CLI: "Đang chờ",
  RUNNING: "Đang tạo giọng…",
  CANCEL_REQUESTED: "Đang huỷ…",
};

export function voiceJobLabel(status: JobStatus): string {
  return VOICE_JOB_LABELS[status] ?? "Đang xử lý";
}

export interface VoiceSummary {
  // Shown scenes without a voice clip.
  missing: number;
  // Shown scenes whose voice is already in the queue (including ones that have a clip and are being made again).
  queued: number;
  // Scenes that lack a clip and are not queued: what "create the missing voices" would send.
  toRequest: number;
}

export function summarizeVoice(scenes: readonly { id: string; audio: unknown }[], jobs: SceneVoiceJobs): VoiceSummary {
  const isQueued = (scene: { id: string }) => activeVoiceJob(jobs[scene.id]) !== null;
  const missing = scenes.filter((scene) => !scene.audio);
  return {
    missing: missing.length,
    queued: scenes.filter(isQueued).length,
    toRequest: missing.filter((scene) => !isQueued(scene)).length,
  };
}
