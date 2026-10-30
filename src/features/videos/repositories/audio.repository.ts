import type { MediaAsset, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export function findSceneWithVideo(sceneId: string) {
  return prisma.videoScene.findFirst({
    where: { id: sceneId, video: { book: { deletedAt: null } } },
    include: { video: { select: { id: true, bookId: true, pace: true } } },
  });
}

export function listVisibleScenesWithoutAudio(videoId: string) {
  return prisma.videoScene.findMany({
    where: { videoId, hidden: false, audioAssetId: null },
    orderBy: { order: "asc" },
    select: { id: true },
  });
}

// Every visible scene with what is needed to tell which voice it has: its narration and the clip it points at.
export function listVisibleScenesForVoice(videoId: string) {
  return prisma.videoScene.findMany({
    where: { videoId, hidden: false },
    orderBy: { order: "asc" },
    select: { id: true, narration: true, audioAssetId: true, mediaAssets: { select: { id: true, provider: true } } },
  });
}

export function createVoiceoverAsset(data: {
  videoId: string;
  sceneId: string;
  path: string;
  mimeType: string;
  durationMs: number;
  fileSizeBytes: number;
  contentHash: string;
  provider: string;
  settings: Prisma.InputJsonObject;
  wordBoundaries?: Prisma.InputJsonArray;
}): Promise<MediaAsset> {
  const { settings, wordBoundaries, ...rest } = data;
  return prisma.mediaAsset.create({
    data: { ...rest, kind: "VOICEOVER", generationSettingsJson: settings, wordBoundariesJson: wordBoundaries },
  });
}

export function findVoiceoverByHash(videoId: string, contentHash: string): Promise<MediaAsset | null> {
  return prisma.mediaAsset.findFirst({
    where: { videoId, kind: "VOICEOVER", contentHash },
    orderBy: { createdAt: "desc" },
  });
}

export function findMediaAsset(id: string): Promise<MediaAsset | null> {
  return prisma.mediaAsset.findUnique({ where: { id } });
}

export function findMediaAssets(ids: readonly string[]): Promise<MediaAsset[]> {
  return prisma.mediaAsset.findMany({ where: { id: { in: [...ids] } } });
}
