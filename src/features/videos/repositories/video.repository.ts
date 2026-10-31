import { notifyPublishMetadataMissingWithin } from "@/features/notifications/repositories/notification-events.repository";
import type { Prisma, Video, VideoScene } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { AppError } from "@/shared/errors";

import { upsertPublishMetadataWithin, type PublishMetadataWrite } from "./publish-metadata.repository";

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
        select: { id: true, provider: true, durationMs: true, generationSettingsJson: true, wordBoundariesJson: true },
      },
    },
  },
  publishMetadata: true,
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
  illustrationJson: string | null;
  shotsJson: string | null;
}

export async function findVideoDetail(id: string) {
  const video = await prisma.video.findFirst({ where: { id, book: { deletedAt: null } }, include: DETAIL_INCLUDE });
  if (!video?.scriptGenerationRunId) return video;
  const generationRun = await prisma.scriptGenerationRun.findUnique({ where: { id: video.scriptGenerationRunId } });
  if (!generationRun)
    throw new AppError("SCRIPT_GENERATION_NOT_FOUND", "Không tìm thấy dữ liệu nguồn và nhân vật của kịch bản.", 409);
  return { ...video, generationRun };
}

export async function listSceneIds(videoId: string): Promise<string[]> {
  const scenes = await prisma.videoScene.findMany({
    where: { videoId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  return scenes.map((scene) => scene.id);
}

export function listVideoRecords(filter: { bookId?: string }, range?: { skip: number; take: number }) {
  return prisma.video.findMany({
    where: { bookId: filter.bookId, book: { deletedAt: null } },
    orderBy: { updatedAt: "desc" },
    include: {
      book: { select: { id: true, title: true } },
      _count: { select: { scenes: true, videoLessons: true } },
      scenes: { where: { type: "HOOK", hidden: false }, select: { onScreenText: true }, take: 1 },
    },
    ...range,
  });
}

// Every video of the book in the order it was made, with nothing else: for screens that list results, not work in progress.
export function listBookVideoRefs(bookId: string): Promise<{ id: string; title: string }[]> {
  return prisma.video.findMany({
    where: { bookId, book: { deletedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true },
  });
}

export function countVideoRecords(filter: { bookId?: string }): Promise<number> {
  return prisma.video.count({ where: { bookId: filter.bookId, book: { deletedAt: null } } });
}

export interface NewVideoRecord {
  bookId: string;
  title: string;
  description: string | null;
  range: { minDurationSec: number; maxDurationSec: number };
  pace: string;
  lessons: { lessonId: string; snapshot: Prisma.InputJsonObject }[];
}

function newVideoData(input: NewVideoRecord): Prisma.VideoUncheckedCreateInput {
  return {
    bookId: input.bookId,
    title: input.title,
    description: input.description,
    ...input.range,
    pace: input.pace,
    // Until a script proposes a length, the plan is the longest the user allows.
    targetDurationSec: input.range.maxDurationSec,
    status: "DRAFT",
    videoLessons: {
      create: input.lessons.map((lesson, index) => ({
        lessonId: lesson.lessonId,
        position: index + 1,
        lessonSnapshotJson: lesson.snapshot,
      })),
    },
  };
}

export function createVideoRecord(input: NewVideoRecord): Promise<Video> {
  return prisma.video.create({ data: newVideoData(input) });
}

// All or none: a request for several videos never leaves some of them behind when one cannot be written.
export function createVideoRecords(inputs: readonly NewVideoRecord[]): Promise<Video[]> {
  return prisma.$transaction(inputs.map((input) => prisma.video.create({ data: newVideoData(input) })));
}

export function updateVideoMetadata(
  id: string,
  data: {
    title: string;
    description: string | null;
    minDurationSec: number;
    maxDurationSec: number;
    pace: string;
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

// Records that the automated checks passed for this script version and approves exactly that version, in one write: the
// checks stand in for the person who would have approved the script. False when the script changed in the meantime, in
// which case nothing is recorded and the checks must run again.
export async function markAutoApproved(id: string, scriptVersion: number): Promise<boolean> {
  const { count } = await prisma.video.updateMany({
    where: { id, scriptVersion },
    data: { autoReadyScriptVersion: scriptVersion, status: "APPROVED", approvedScriptVersion: scriptVersion },
  });
  return count > 0;
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

export type ReplacementScript = {
  generation?: { id: string };
  hookOptions: Prisma.InputJsonValue;
  scenes: readonly NewSceneRecord[];
  // The length the AI wrote this script for, when it proposed one with it.
  duration?: { targetDurationSec: number; durationReason: string };
  // The title, caption and hashtags the AI wrote with the script; without them the previous set stays, marked outdated.
  publish?: PublishMetadataWrite;
  // Why `publish` is missing when the AI was asked for it; reported on Telegram, since the script itself is written.
  publishIssue?: { code: string; message: string };
};

// The one place a whole script is written, so the manual flow and the production flow cannot drift apart. The caller
// supplies the transaction when the write must be atomic with something else.
export async function replaceScriptWithin(tx: Tx, videoId: string, script: ReplacementScript): Promise<Video> {
  if (script.generation) {
    const run = await tx.scriptGenerationRun.findUniqueOrThrow({ where: { id: script.generation.id } });
    if (run.videoId !== videoId || !run.castJson || !run.scenePlanArtifactJson)
      throw new AppError("SCRIPT_GENERATION_INVALID", "Lần tạo kịch bản chưa có đủ cảnh và nhân vật.", 409);
    if (run.appliedScriptVersion !== null) {
      const current = await tx.video.findUniqueOrThrow({ where: { id: videoId } });
      if (current.scriptGenerationRunId !== run.id)
        throw new AppError("SCRIPT_GENERATION_STALE", "Video đã có kịch bản mới hơn.", 409);
      return current;
    }
    const expectedVersion = run.baseScriptVersion;
    const gate = await tx.video.updateMany({
      where: { id: videoId, scriptVersion: expectedVersion },
      data: { scriptGenerationRunId: run.id },
    });
    if (!gate.count)
      throw new AppError(
        "SCRIPT_GENERATION_STALE",
        "Video đã được sửa trong lúc AI chạy. Kịch bản hiện tại được giữ nguyên.",
        409,
      );
  }
  await tx.videoScene.deleteMany({ where: { videoId } });
  await tx.videoScene.createMany({
    data: script.scenes.map((scene, order) => ({ ...scene, videoId, order })),
  });
  if (script.publish) await upsertPublishMetadataWithin(tx, videoId, script.publish);
  const video = await bumpScript(tx, videoId, { hookOptionsJson: script.hookOptions, ...script.duration });
  if (script.generation)
    await tx.scriptGenerationRun.update({
      where: { id: script.generation.id },
      data: { appliedScriptVersion: video.scriptVersion },
    });
  if (script.publishIssue) await notifyPublishMetadataMissingWithin(tx, video, script.publishIssue);
  return video;
}

export function replaceScript(videoId: string, script: ReplacementScript): Promise<Video> {
  return prisma.$transaction((tx) => replaceScriptWithin(tx, videoId, script));
}

// Whether an automated production still owns this video: while it does, edits, audio and renders made by hand would be
// overwritten or would race the pipeline.
export async function isVideoInActiveProduction(videoId: string): Promise<boolean> {
  const item = await prisma.productionItem.findFirst({
    where: { videoId, status: { in: ["PENDING", "RUNNING", "WAITING"] } },
    select: { id: true },
  });
  return item !== null;
}

// The draft an automated production wrote for this video, as stored (null for a video made by hand).
export async function findProductionDraftForVideo(videoId: string): Promise<unknown> {
  const item = await prisma.productionItem.findUnique({ where: { videoId }, select: { draftArtifactJson: true } });
  return item?.draftArtifactJson ?? null;
}

export function updateSceneRecord(
  videoId: string,
  sceneId: string,
  data: Partial<NewSceneRecord> & { hidden?: boolean },
  change: { contentChanged: boolean; narrationChanged: boolean; expectedVersion?: number },
): Promise<VideoScene> {
  return prisma.$transaction(async (tx) => {
    if (change.expectedVersion !== undefined) {
      const gate = await tx.videoScene.updateMany({
        where: { id: sceneId, videoId, version: change.expectedVersion },
        data: { updatedAt: new Date() },
      });
      if (!gate.count)
        throw new AppError(
          "SCENE_REGENERATION_STALE",
          "Cảnh đã được sửa trong lúc AI chạy. Nội dung hiện tại được giữ nguyên.",
          409,
        );
    }
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

// New length estimates for scenes that have no audio yet; they change what a render would show, so earlier renders go outdated.
export function setSceneEstimates(
  videoId: string,
  estimates: readonly { sceneId: string; estimatedSeconds: number; durationFrames: number }[],
): Promise<void> {
  return prisma.$transaction(async (tx) => {
    for (const { sceneId, ...data } of estimates) await tx.videoScene.update({ where: { id: sceneId, videoId }, data });
    await bumpContentVersion(tx, videoId);
  });
}

export function findApprovedLessonsForVideo(bookId: string, lessonIds: readonly string[]) {
  return prisma.lesson.findMany({
    where: { id: { in: [...lessonIds] }, bookId },
    include: { sources: { include: { chapter: { select: { id: true, title: true } } } } },
  });
}
