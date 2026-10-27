import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { trimSilence } from "@/server/media/audio-tools";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { synthesizeWithEdgeTts } from "@/server/tts/edge-tts";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

import { formatEdgeTtsRate, TTS_ENGINE_VERSION } from "../domain/audio";
import { audioDirectory, requireScene, reuseCachedVoiceover, storeSceneAudio } from "./audio.service";

const TTS_TIMEOUT_MS = 90_000;

export async function runSceneTts(run: {
  sceneId: string;
  signal?: AbortSignal;
}): Promise<{ sceneId: string; cached: boolean }> {
  const { mode, voice, speed, edgeTtsCommand } = getAppConfig().tts;
  if (mode !== "edge-tts")
    throw new AppError("TTS_DISABLED", "TTS_MODE=upload: hãy tải âm thanh lên cho từng cảnh.", 409);

  const scene = await requireScene(run.sceneId);
  const narration = scene.narration.trim();
  if (!narration) throw new AppError("EMPTY_NARRATION", "Cảnh chưa có lời dẫn.", 409);

  const contentHash = createHash("sha256")
    .update(JSON.stringify([TTS_ENGINE_VERSION, voice, speed, narration]))
    .digest("hex");
  if (await reuseCachedVoiceover(scene.video.id, scene.id, contentHash)) return { sceneId: scene.id, cached: true };

  const base = dataPath(audioDirectory(scene.video.id), `tts-${randomUUID()}`);
  const textFile = `${base}.txt`;
  const rawFile = `${base}.raw.mp3`;
  const trimmedFile = `${base}.mp3`;
  try {
    // The narration goes through a text file, never through a shell command line.
    await writeFileAtomic(textFile, narration);
    await synthesizeWithEdgeTts({
      command: edgeTtsCommand,
      textFile,
      voice,
      rate: formatEdgeTtsRate(speed),
      outputFile: rawFile,
      timeoutMs: TTS_TIMEOUT_MS,
      signal: run.signal,
    });
    await trimSilence(rawFile, trimmedFile);
    await storeSceneAudio({
      videoId: scene.video.id,
      sceneId: scene.id,
      tempFile: trimmedFile,
      format: "mp3",
      provider: "edge-tts",
      contentHash,
      settings: { voice, speed, engine: TTS_ENGINE_VERSION },
    });
    return { sceneId: scene.id, cached: false };
  } finally {
    await Promise.all([textFile, rawFile, trimmedFile].map((file) => fs.rm(file, { force: true })));
  }
}
