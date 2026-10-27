import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { probeMedia } from "@/server/media/ffprobe";
import { measureLeadingSilenceMs } from "@/server/media/audio-tools";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";

import {
  AUDIO_MIME_TYPES,
  detectAudioFormat,
  framesForAudio,
  MAX_AUDIO_SECONDS,
  type AudioFormat,
} from "../domain/audio";
import { estimateNarrationSeconds, secondsToFrames } from "../domain/duration";
import { createVoiceoverAsset, findSceneWithVideo, findVoiceoverByHash } from "../repositories/audio.repository";
import { setSceneAudio } from "../repositories/video.repository";

const ACCEPTED_UPLOAD_MIME = new Set([
  "",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "application/octet-stream",
]);

export const audioDirectory = (videoId: string) => `videos/${videoId}/audio`;

export async function requireScene(sceneId: string) {
  const scene = await findSceneWithVideo(sceneId);
  if (!scene) throw new NotFoundError("SCENE_NOT_FOUND", "Không tìm thấy cảnh.");
  return scene;
}

interface StoreAudioInput {
  videoId: string;
  sceneId: string;
  tempFile: string;
  format: AudioFormat;
  provider: "edge-tts" | "upload";
  contentHash: string;
  settings: Record<string, string | number>;
}

// Validates with ffprobe, files the clip under its content hash and sets the scene length from the real duration.
export async function storeSceneAudio(input: StoreAudioInput): Promise<void> {
  const relativePath = `${audioDirectory(input.videoId)}/${input.contentHash}.${input.format}`;
  const finalFile = dataPath(relativePath);
  try {
    const probe = await probeMedia(input.tempFile).catch(() => null);
    if (!probe?.audio || probe.durationMs <= 200) {
      throw new AppError("INVALID_AUDIO", "Tệp không có luồng âm thanh hợp lệ.", 400);
    }
    if (probe.durationMs > MAX_AUDIO_SECONDS * 1000) {
      throw new AppError("AUDIO_TOO_LONG", `Âm thanh dài hơn ${MAX_AUDIO_SECONDS} giây cho một cảnh.`, 400);
    }
    await fs.mkdir(path.dirname(finalFile), { recursive: true });
    await fs.rename(input.tempFile, finalFile);

    const leadingSilenceMs = await measureLeadingSilenceMs(finalFile).catch(() => 0);
    const asset = await createVoiceoverAsset({
      videoId: input.videoId,
      sceneId: input.sceneId,
      path: relativePath,
      mimeType: AUDIO_MIME_TYPES[input.format],
      durationMs: probe.durationMs,
      fileSizeBytes: probe.sizeBytes,
      contentHash: input.contentHash,
      provider: input.provider,
      settings: { ...input.settings, leadingSilenceMs },
    });
    await setSceneAudio(input.videoId, input.sceneId, {
      audioAssetId: asset.id,
      durationFrames: framesForAudio(probe.durationMs, getAppConfig().tts.paddingMs),
    });
  } finally {
    await fs.rm(input.tempFile, { force: true });
  }
}

// Identical narration + voice + speed reuses the clip already generated for this video.
export async function reuseCachedVoiceover(videoId: string, sceneId: string, contentHash: string): Promise<boolean> {
  const cached = await findVoiceoverByHash(videoId, contentHash);
  if (!cached?.durationMs) return false;
  const exists = await fs.stat(dataPath(cached.path)).then(
    () => true,
    () => false,
  );
  if (!exists) return false;
  await setSceneAudio(videoId, sceneId, {
    audioAssetId: cached.id,
    durationFrames: framesForAudio(cached.durationMs, getAppConfig().tts.paddingMs),
  });
  return true;
}

export async function uploadSceneAudio(
  sceneId: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<void> {
  const scene = await requireScene(sceneId);
  const { maxUploadBytes } = getAppConfig().tts;
  if (file.bytes.byteLength > maxUploadBytes) {
    throw new AppError("FILE_TOO_LARGE", `Tệp âm thanh vượt quá ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`, 413);
  }
  const format = detectAudioFormat(file.bytes);
  if (!format || !ACCEPTED_UPLOAD_MIME.has(file.type.toLowerCase())) {
    throw new AppError("UNSUPPORTED_AUDIO", "Chỉ nhận tệp MP3 hoặc WAV.", 415);
  }

  const contentHash = createHash("sha256").update(file.bytes).digest("hex");
  const tempFile = dataPath(audioDirectory(scene.video.id), `upload-${randomUUID()}.part`);
  await writeFileAtomic(tempFile, file.bytes);
  await storeSceneAudio({
    videoId: scene.video.id,
    sceneId,
    tempFile,
    format,
    provider: "upload",
    contentHash,
    settings: { originalName: path.basename(file.name).slice(0, 120) },
  });
}

export async function detachSceneAudio(sceneId: string): Promise<void> {
  const scene = await requireScene(sceneId);
  await setSceneAudio(scene.video.id, sceneId, {
    audioAssetId: null,
    durationFrames: secondsToFrames(estimateNarrationSeconds(scene.narration)),
  });
}
