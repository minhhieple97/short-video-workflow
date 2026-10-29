import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { trimSilence } from "@/server/media/audio-tools";
import { dataPath } from "@/server/storage/paths";
import { createTtsProvider } from "@/server/tts";
import type { TtsProvider } from "@/server/tts/tts-provider";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

import { audioDirectory, requireScene, reuseCachedVoiceover, sceneProfile, storeSceneAudio } from "./audio.service";

export async function runSceneTts(run: {
  sceneId: string;
  signal?: AbortSignal;
  provider?: TtsProvider;
}): Promise<{ sceneId: string; cached: boolean }> {
  const { voice } = getAppConfig().tts;
  const provider = run.provider ?? createTtsProvider();

  const scene = await requireScene(run.sceneId);
  const narration = scene.narration.trim();
  if (!narration) throw new AppError("EMPTY_NARRATION", "Cảnh chưa có lời dẫn.", 409);
  const { speedPercent, paddingMs } = sceneProfile(scene);

  const contentHash = createHash("sha256")
    .update(JSON.stringify([provider.engineVersion, voice, speedPercent, narration]))
    .digest("hex");
  if (await reuseCachedVoiceover(scene.video.id, scene.id, contentHash, paddingMs))
    return { sceneId: scene.id, cached: true };

  const base = dataPath(audioDirectory(scene.video.id), `tts-${randomUUID()}`);
  const rawFile = `${base}.raw.mp3`;
  const trimmedFile = `${base}.mp3`;
  try {
    await fs.mkdir(path.dirname(rawFile), { recursive: true });
    await provider.synthesize({ text: narration, voice, speedPercent, outputFile: rawFile }, { signal: run.signal });
    await trimSilence(rawFile, trimmedFile);
    await storeSceneAudio({
      videoId: scene.video.id,
      sceneId: scene.id,
      tempFile: trimmedFile,
      format: "mp3",
      provider: provider.id,
      contentHash,
      paddingMs,
      settings: { voice, speed: speedPercent, engine: provider.engineVersion },
    });
    return { sceneId: scene.id, cached: false };
  } finally {
    await Promise.all([rawFile, trimmedFile].map((file) => fs.rm(file, { force: true })));
  }
}
