import { prisma } from "@/server/db/client";

export interface JobEntityIds {
  chapterIds: string[];
  videoIds: string[];
  sceneIds: string[];
  renderIds: string[];
}

// Batched lookups for the entities referenced by JobRecord.entityType/entityId.
export async function findJobEntities(ids: JobEntityIds) {
  const [chapters, videos, scenes, renders] = await Promise.all([
    prisma.chapter.findMany({ where: { id: { in: ids.chapterIds } }, select: { id: true, title: true, bookId: true } }),
    prisma.video.findMany({ where: { id: { in: ids.videoIds } }, select: { id: true, title: true } }),
    prisma.videoScene.findMany({
      where: { id: { in: ids.sceneIds } },
      select: { id: true, order: true, videoId: true, video: { select: { title: true } } },
    }),
    prisma.renderRecord.findMany({
      where: { id: { in: ids.renderIds } },
      select: { id: true, qualityPreset: true, videoId: true, video: { select: { title: true } } },
    }),
  ]);
  return { chapters, videos, scenes, renders };
}
