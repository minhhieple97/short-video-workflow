import type { Prisma, Video, VideoScene } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type Tx = Prisma.TransactionClient;

const DETAIL_INCLUDE = {
  book: { select: { id: true, title: true, author: true, deletedAt: true } },
  videoLessons: {
    orderBy: { position: "asc" as const },
    include: { lesson: { select: { id: true, title: true, status: true, contentHash: true } } },
  },
  scenes: {
    orderBy: { order: "asc" as const },
    include: {
      mediaAssets: {
        where: { kind: "VOICEOVER" as const },
        select: { id: true, provider: true, durationMs: true, generationSettingsJson: true },
      },
    },
  },
};

export type VideoDetailRecord = NonNullable<Awaited<ReturnType<typeof findVideoDetail>>>;

export interface NewSceneRecord {
  type: string;
  title: string | null;
  narration: string;
  onScreenText: string;
  visualVariant: string;
  hookVariant: string | null;
  estimatedSeconds: number;
  durationFrames: number;
  contentHash: string;
}

export function findVideoDetail(id: string) {
  return prisma.video.findFirst({ where: { id, book: { deletedAt: null } }, include: DETAIL_INCLUDE });
}

export function listVideoRecords(filter: { bookId?: string }) {
  return prisma.video.findMany({
    where: { bookId: filter.bookId, book: { deletedAt: null } },
    orderBy: { updatedAt: "desc" },
    include: {
      book: { select: { id: true, title: true } },
      _count: { select: { scenes: true, videoLessons: true } },
      scenes: { where: { type: "HOOK", hidden: false }, select: { onScreenText: true }, take: 1 },
    },
  });
}

export function createVideoRecord(input: {
  bookId: string;
  title: string;
  description: string | null;
  targetDurationSec: number;
  lessons: { lessonId: string; snapshot: Prisma.InputJsonObject }[];
}): Promise<Video> {
  return prisma.video.create({
    data: {
      bookId: input.bookId,
      title: input.title,
      description: input.description,
      targetDurationSec: input.targetDurationSec,
      status: "DRAFT",
      videoLessons: {
        create: input.lessons.map((lesson, index) => ({
          lessonId: lesson.lessonId,
          position: index + 1,
          lessonSnapshotJson: lesson.snapshot,
        })),
      },
    },
  });
}

export function updateVideoMetadata(
  id: string,
  data: {
    title: string;
    description: string | null;
    targetDurationSec: number;
    platformPreviewMode: "TIKTOK" | "YOUTUBE_SHORTS" | "FACEBOOK_REELS" | null;
  },
): Promise<Video> {
  return prisma.video.update({ where: { id }, data });
}

export function setPreviewMode(
  id: string,
  platformPreviewMode: "TIKTOK" | "YOUTUBE_SHORTS" | "FACEBOOK_REELS",
): Promise<Video> {
  return prisma.video.update({ where: { id }, data: { platformPreviewMode } });
}

export function deleteVideoRecord(id: string): Promise<Video> {
  return prisma.video.delete({ where: { id } });
}

export function markScriptApproved(id: string, scriptVersion: number): Promise<Video> {
  return prisma.video.update({ where: { id }, data: { status: "APPROVED", approvedScriptVersion: scriptVersion } });
}

// Audio changes make earlier renders outdated without sending an approved script back to review.
function bumpContentVersion(tx: Tx, videoId: string) {
  return tx.video.update({ where: { id: videoId }, data: { scriptVersion: { increment: 1 } } });
}

// Any script edit creates a new script version and sends the script back to review.
function bumpScript(tx: Tx, videoId: string, extra: Prisma.VideoUpdateInput = {}) {
  return tx.video.update({
    where: { id: videoId },
    data: { scriptVersion: { increment: 1 }, status: "NEEDS_REVIEW", ...extra },
  });
}

// (videoId, order) is unique, so orders move through negative placeholders before taking their final values.
async function rewriteOrder(tx: Tx, orderedIds: readonly string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await tx.videoScene.update({ where: { id }, data: { order: -(index + 1) } });
  }
  for (const [index, id] of orderedIds.entries()) {
    await tx.videoScene.update({ where: { id }, data: { order: index } });
  }
}

export function replaceScript(
  videoId: string,
  script: { hookOptions: Prisma.InputJsonValue; scenes: readonly NewSceneRecord[] },
): Promise<Video> {
  return prisma.$transaction(async (tx) => {
    await tx.videoScene.deleteMany({ where: { videoId } });
    await tx.videoScene.createMany({
      data: script.scenes.map((scene, order) => ({ ...scene, videoId, order })),
    });
    return bumpScript(tx, videoId, { hookOptionsJson: script.hookOptions });
  });
}

export function updateSceneRecord(
  videoId: string,
  sceneId: string,
  data: Partial<NewSceneRecord> & { hidden?: boolean },
  change: { contentChanged: boolean; narrationChanged: boolean },
): Promise<VideoScene> {
  return prisma.$transaction(async (tx) => {
    const scene = await tx.videoScene.update({
      where: { id: sceneId, videoId },
      data: {
        ...data,
        ...(change.contentChanged ? { version: { increment: 1 } } : {}),
        ...(change.narrationChanged ? { audioAssetId: null } : {}),
      },
    });
    await bumpScript(tx, videoId);
    return scene;
  });
}

// afterSceneId = null inserts at the very start.
export function insertSceneAfter(
  videoId: string,
  afterSceneId: string | null,
  data: NewSceneRecord,
): Promise<VideoScene> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.videoScene.findMany({
      where: { videoId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    const created = await tx.videoScene.create({ data: { ...data, videoId, order: -1000 } });
    const ids = existing.map((scene) => scene.id);
    const position = afterSceneId ? ids.indexOf(afterSceneId) + 1 : 0;
    ids.splice(position, 0, created.id);
    await rewriteOrder(tx, ids);
    await bumpScript(tx, videoId);
    return created;
  });
}

export function deleteSceneRecord(videoId: string, sceneId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.videoScene.delete({ where: { id: sceneId, videoId } });
    const remaining = await tx.videoScene.findMany({
      where: { videoId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    await rewriteOrder(
      tx,
      remaining.map((scene) => scene.id),
    );
    await bumpScript(tx, videoId);
  });
}

export function reorderSceneRecords(videoId: string, orderedIds: readonly string[]): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await rewriteOrder(tx, orderedIds);
    await bumpScript(tx, videoId);
  });
}

export function setSceneAudio(
  videoId: string,
  sceneId: string,
  audio: { audioAssetId: string | null; durationFrames: number },
): Promise<VideoScene> {
  return prisma.$transaction(async (tx) => {
    const scene = await tx.videoScene.update({ where: { id: sceneId, videoId }, data: audio });
    await bumpContentVersion(tx, videoId);
    return scene;
  });
}

export function findApprovedLessonsForVideo(bookId: string, lessonIds: readonly string[]) {
  return prisma.lesson.findMany({
    where: { id: { in: [...lessonIds] }, bookId },
    include: { sources: { include: { chapter: { select: { id: true, title: true } } } } },
  });
}
