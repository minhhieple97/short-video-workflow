import { getBook } from "@/features/books/services/book.service";
import { findActiveJobForEntities, findActiveJobForEntity } from "@/features/jobs/repositories/job-record.repository";
import { toJobDto } from "@/features/jobs/services/job-dto";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { assessLessonLoad } from "../domain/duration";
import type { LessonSnapshot } from "../domain/lesson-snapshot";
import { toVideoStatus } from "../domain/video-status";
import {
  createVideoRecord,
  deleteVideoRecord,
  findApprovedLessonsForVideo,
  findVideoDetail,
  listSceneIds,
  listVideoRecords,
  markScriptApproved,
  setPreviewMode,
  updateVideoMetadata,
  type VideoDetailRecord,
} from "../repositories/video.repository";
import type { VideoDetail, VideoSummary } from "../schemas/video.dto";
import type { CreateVideoInput, UpdateVideoInput } from "../schemas/video.schema";
import { toVideoDetail } from "./video-mapper";

export async function requireVideo(id: string): Promise<VideoDetailRecord> {
  const video = await findVideoDetail(id);
  if (!video) throw new NotFoundError("VIDEO_NOT_FOUND", "Không tìm thấy video.");
  return video;
}

export async function getVideo(id: string): Promise<VideoDetail> {
  return toVideoDetail(await requireVideo(id));
}

export async function listVideos(filter: { bookId?: string } = {}): Promise<VideoSummary[]> {
  return (await listVideoRecords(filter)).map((video) => ({
    id: video.id,
    title: video.title,
    status: toVideoStatus(video.status),
    book: video.book,
    targetDurationSec: video.targetDurationSec,
    lessonCount: video._count.videoLessons,
    sceneCount: video._count.scenes,
    hookText: video.scenes[0]?.onScreenText ?? null,
    updatedAt: video.updatedAt.toISOString(),
  }));
}

export async function createVideo(input: CreateVideoInput): Promise<{ video: VideoDetail; warnings: string[] }> {
  const book = await getBook(input.bookId);
  const lessonIds = [...new Set(input.lessonIds)];
  const lessons = await findApprovedLessonsForVideo(book.id, lessonIds);
  if (lessons.length !== lessonIds.length) {
    throw new AppError("LESSON_NOT_IN_BOOK", "Mọi bài học phải thuộc cùng cuốn sách của video.", 400);
  }
  if (lessons.some((lesson) => lesson.status !== "APPROVED")) {
    throw new AppError("LESSON_NOT_APPROVED", "Chỉ dùng bài học đã duyệt để tạo video mới.", 409);
  }

  const capturedAt = new Date().toISOString();
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const ordered = lessonIds.flatMap((id) => byId.get(id) ?? []);
  const video = await createVideoRecord({
    bookId: book.id,
    title: input.title,
    description: input.description,
    targetDurationSec: input.targetDurationSec,
    lessons: ordered.map((lesson) => {
      const snapshot: LessonSnapshot = {
        lessonId: lesson.id,
        title: lesson.title,
        summary: lesson.summary,
        principle: lesson.principle,
        realLifeScenario: lesson.realLifeScenario,
        commonMistake: lesson.commonMistake,
        betterApproach: lesson.betterApproach,
        actionableStep: lesson.actionableStep,
        contentHash: lesson.contentHash,
        sources: lesson.sources.map((source) => ({
          chapterId: source.chapter.id,
          chapterTitle: source.chapter.title,
          excerpt: source.sourceExcerpt,
        })),
        capturedAt,
      };
      return { lessonId: lesson.id, snapshot };
    }),
  });

  const load = assessLessonLoad(lessonIds.length, input.targetDurationSec);
  return { video: await getVideo(video.id), warnings: load.level === "ok" ? [] : [load.message] };
}

export async function updateVideo(id: string, input: UpdateVideoInput): Promise<VideoDetail> {
  await requireVideo(id);
  await assertScriptNotGenerating(id);
  await updateVideoMetadata(id, {
    title: input.title,
    description: input.description,
    targetDurationSec: input.targetDurationSec,
    platformPreviewMode: input.platformPreviewMode,
  });
  return getVideo(id);
}

export async function updatePreviewMode(
  id: string,
  mode: "TIKTOK" | "YOUTUBE_SHORTS" | "FACEBOOK_REELS",
): Promise<void> {
  await requireVideo(id);
  await setPreviewMode(id, mode);
}

export async function deleteVideo(id: string): Promise<void> {
  await requireVideo(id);
  await assertScriptNotGenerating(id);
  await deleteVideoRecord(id);
}

export async function approveScript(id: string): Promise<VideoDetail> {
  await assertScriptNotGenerating(id);
  const video = await getVideo(id);
  if (video.scenes.length === 0) throw new AppError("SCRIPT_EMPTY", "Chưa có kịch bản để duyệt.", 409);
  if (video.hookIssues.length > 0) throw new AppError("HOOK_INVALID", video.hookIssues.join(" "), 409);
  await markScriptApproved(id, video.scriptVersion);
  return getVideo(id);
}

export interface ActiveVideoJob {
  job: JobDto;
  sceneId: string | null;
  sceneNumber: number | null;
}

export async function findActiveVideoJob(videoId: string): Promise<ActiveVideoJob | null> {
  const script = await findActiveJobForEntity("GENERATE_VIDEO_SCRIPT", "VIDEO", videoId);
  if (script) return { job: toJobDto(script), sceneId: null, sceneNumber: null };
  const sceneIds = await listSceneIds(videoId);
  const rewrite = await findActiveJobForEntities("GENERATE_VIDEO_SCRIPT", "SCENE", sceneIds);
  if (!rewrite) return null;
  return { job: toJobDto(rewrite), sceneId: rewrite.entityId, sceneNumber: sceneIds.indexOf(rewrite.entityId) + 1 };
}

// While a script job (the whole script or one scene rewrite) is queued, running or waiting for Claude Code the script
// is about to change: edits, audio and renders made now would be lost, and new settings would no longer match what the
// AI returns. `target` names the job the caller is about to enqueue; one already active for that same target is fine
// because enqueueing dedupes it. Only user-facing services call this; the worker writes through repositories.
export async function assertScriptNotGenerating(videoId: string, target?: { sceneId: string | null }): Promise<void> {
  const active = await findActiveVideoJob(videoId);
  if (!active || (target && active.sceneId === target.sceneId)) return;
  throw new AppError(
    "SCRIPT_GENERATION_IN_PROGRESS",
    active.sceneId === null
      ? "Kịch bản đang được tạo. Hãy đợi tác vụ xong hoặc huỷ nó trước khi thay đổi video."
      : "Một cảnh đang được viết lại. Hãy đợi tác vụ xong hoặc huỷ nó trước khi thay đổi video.",
    409,
  );
}
