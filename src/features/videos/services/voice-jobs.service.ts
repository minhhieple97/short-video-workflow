import "server-only";

import { findLatestJobsForEntities } from "@/features/jobs/repositories/job-record.repository";
import { isActiveJobStatus } from "@/shared/types/job";

import type { SceneVoiceJobs } from "../domain/voice-queue";
import { listSceneIds } from "../repositories/video.repository";

// What is happening, or last went wrong, with the voice of each scene of the video. A scene's newest voice job matters only
// while it is unfinished or has failed; a finished or cancelled one needs no mention, because the clip itself shows it.
export async function getVoiceJobs(videoId: string): Promise<SceneVoiceJobs> {
  const sceneIds = await listSceneIds(videoId);
  if (sceneIds.length === 0) return {};
  const byScene: Record<string, SceneVoiceJobs[string]> = {};
  for (const job of await findLatestJobsForEntities("GENERATE_SCENE_TTS", "SCENE", sceneIds)) {
    if (isActiveJobStatus(job.status))
      byScene[job.entityId] = { jobId: job.id, status: job.status, errorMessage: null };
    else if (job.status === "FAILED") {
      byScene[job.entityId] = { jobId: job.id, status: job.status, errorMessage: job.errorMessage };
    }
  }
  return byScene;
}
