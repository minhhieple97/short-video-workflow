import type { MediaAsset, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export function findSceneWithVideo(sceneId: string) {
  return prisma.videoScene.findFirst({
    where: { id: sceneId, video: { book: { deletedAt: null } } },
    include: { video: { select: { id: true, bookId: true } } },
  });
}

export function listVisibleScenesWithoutAudio(videoId: string) {
  return prisma.videoScene.findMany({
    where: { videoId, hidden: false, audioAssetId: null },
    orderBy: { order: "asc" },
    select: { id: true },
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
  provider: "edge-tts" | "upload";
  settings: Prisma.InputJsonObject;
}): Promise<MediaAsset> {
  const { settings, ...rest } = data;
  return prisma.mediaAsset.create({ data: { ...rest, kind: "VOICEOVER", generationSettingsJson: settings } });
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
