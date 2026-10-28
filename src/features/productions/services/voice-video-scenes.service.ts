import { listVisibleScenesWithoutAudio } from "@/features/videos/repositories/audio.repository";
import { runSceneTts } from "@/features/videos/services/tts-runner";
import { JobCancelledError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

const logger = createLogger("productions.voice");

export type SynthesizeScene = (run: {
  sceneId: string;
  signal?: AbortSignal;
}) => Promise<{ sceneId: string; cached: boolean }>;

export interface VoiceSummary {
  // Scenes that had no audio when this ran.
  pending: number;
  synthesized: number;
  // Scenes whose narration matched an earlier synthesis, so no speech was generated for them.
  reused: number;
}

// Voices the visible scenes that still have no audio, one scene at a time and in order: edge-tts is an online service
// and the worker runs one job at a time, so parallel calls would only trip its limits. Stopping early (a failure or a
// cancel) keeps the audio already stored, so the next run resumes at the first scene still without it.
export async function voiceVideoScenes(input: {
  videoId: string;
  signal?: AbortSignal;
  synthesize?: SynthesizeScene;
  onProgress?: (done: number, pending: number) => Promise<void> | void;
}): Promise<VoiceSummary> {
  const synthesize = input.synthesize ?? runSceneTts;
  const scenes = await listVisibleScenesWithoutAudio(input.videoId);
  const summary: VoiceSummary = { pending: scenes.length, synthesized: 0, reused: 0 };

  for (const scene of scenes) {
    if (input.signal?.aborted) throw new JobCancelledError();
    const result = await synthesize({ sceneId: scene.id, signal: input.signal });
    if (result.cached) summary.reused += 1;
    else summary.synthesized += 1;
    await input.onProgress?.(summary.synthesized + summary.reused, summary.pending);
  }
  logger.info("Scenes voiced", { videoId: input.videoId, ...summary });
  return summary;
}
