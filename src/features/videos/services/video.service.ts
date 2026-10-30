import { getBook } from "@/features/books/services/book.service";
import { findActiveJobForEntities, findActiveJobForEntity } from "@/features/jobs/repositories/job-record.repository";
import { toJobDto } from "@/features/jobs/services/job-dto";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";
import { loadPage, mapPage, type Page, type PageRequest } from "@/shared/pagination";
import type { JobDto } from "@/shared/types/job";

import {
  assessLessonLoad,
  clampToRange,
  estimateNarrationSeconds,
  formatPreset,
  secondsToFrames,
  type DurationRange,
} from "../domain/duration";
import { syllablesPerSecond, toPace } from "../domain/pace";
import { toVideoStatus } from "../domain/video-status";
import {
  countVideoRecords,
  createVideoRecord,
  createVideoRecords,
  deleteVideoRecord,
  findApprovedLessonsForVideo,
  findVideoDetail,
  isVideoInActiveProduction,
  listSceneIds,
  listVideoRecords,
  markScriptApproved,
  setSceneEstimates,
  setPreviewMode,
  updateVideoMetadata,
  type VideoDetailRecord,
} from "../repositories/video.repository";
import type { VideoDetail, VideoSummary } from "../schemas/video.dto";
import type { CreateVideoInput, CreateVideosFromLessonsInput, UpdateVideoInput } from "../schemas/video.schema";
import { buildLessonSnapshot } from "./lesson-snapshot-builder";
import { toVideoDetail } from "./video-mapper";

export async function requireVideo(id: string): Promise<VideoDetailRecord> {
  const video = await findVideoDetail(id);
  if (!video) throw new NotFoundError("VIDEO_NOT_FOUND", "Không tìm thấy video.");
  return video;
}

// The range a new video or batch starts with, from the settings.
export function defaultDurationRange(): DurationRange {
  const { defaultMinDurationSec, maxDurationSec } = getAppConfig().video;
  return { minDurationSec: defaultMinDurationSec, maxDurationSec };
}

// The forms only offer lengths up to MAX_VIDEO_DURATION_SEC; this holds the line for any other caller too.
export function assertDurationRangeAllowed(range: DurationRange): void {
  const ceiling = getAppConfig().video.maxDurationSec;
  if (range.maxDurationSec > ceiling) {
    throw new AppError(
      "DURATION_OVER_LIMIT",
      `Thời lượng dài nhất ${formatPreset(range.maxDurationSec)} vượt giới hạn ${formatPreset(ceiling)} đặt cho máy này.`,
      400,
    );
  }
}

export async function getVideo(id: string): Promise<VideoDetail> {
  return toVideoDetail(await requireVideo(id));
}

function toVideoSummary(video: Awaited<ReturnType<typeof listVideoRecords>>[number]): VideoSummary {
  return {
    id: video.id,
    title: video.title,
    status: toVideoStatus(video.status),
    book: video.book,
    targetDurationSec: video.targetDurationSec,
    minDurationSec: video.minDurationSec,
    maxDurationSec: video.maxDurationSec,
    durationProposed: video.durationReason !== null,
    lessonCount: video._count.videoLessons,
    sceneCount: video._count.scenes,
    hookText: video.scenes[0]?.onScreenText ?? null,
    updatedAt: video.updatedAt.toISOString(),
  };
}

export async function listVideos(filter: { bookId?: string } = {}): Promise<VideoSummary[]> {
  return (await listVideoRecords(filter)).map(toVideoSummary);
}

export async function listVideosPage(filter: { bookId?: string }, request: PageRequest): Promise<Page<VideoSummary>> {
  const records = await loadPage(request, {
    count: () => countVideoRecords(filter),
    fetch: (range) => listVideoRecords(filter, range),
  });
  return mapPage(records, toVideoSummary);
}

// The approved lessons of the book, in the order asked for, each with the snapshot a new video keeps of it.
async function loadLessonsForNewVideos(bookId: string, requested: readonly string[]) {
  const lessonIds = [...new Set(requested)];
  const lessons = await findApprovedLessonsForVideo(bookId, lessonIds);
  if (lessons.length !== lessonIds.length) {
    throw new AppError("LESSON_NOT_IN_BOOK", "Mọi bài học phải thuộc cùng cuốn sách của video.", 400);
  }
  if (lessons.some((lesson) => lesson.status !== "APPROVED")) {
    throw new AppError("LESSON_NOT_APPROVED", "Chỉ dùng bài học đã duyệt để tạo video mới.", 409);
  }

  const capturedAt = new Date().toISOString();
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  return lessonIds
    .flatMap((id) => byId.get(id) ?? [])
    .map((lesson) => ({ lesson, snapshot: buildLessonSnapshot(lesson, capturedAt) }));
}

export async function createVideo(input: CreateVideoInput): Promise<{ video: VideoDetail; warnings: string[] }> {
  assertDurationRangeAllowed(input);
  const book = await getBook(input.bookId);
  const lessons = await loadLessonsForNewVideos(book.id, input.lessonIds);
  const video = await createVideoRecord({
    bookId: book.id,
    title: input.title,
    description: input.description,
    range: { minDurationSec: input.minDurationSec, maxDurationSec: input.maxDurationSec },
    pace: input.pace ?? getAppConfig().video.defaultPace,
    lessons: lessons.map(({ lesson, snapshot }) => ({ lessonId: lesson.id, snapshot })),
  });

  const load = assessLessonLoad(lessons.length, input.maxDurationSec);
  return { video: await getVideo(video.id), warnings: load.level === "ok" ? [] : [load.message] };
}

const MAX_VIDEO_TITLE = 200;

// One video for each approved lesson, titled like the lesson and in the order asked for. All of them are written
// together, so a request never leaves part of itself behind.
export async function createVideosFromLessons(
  input: CreateVideosFromLessonsInput,
): Promise<{ videos: { id: string; title: string }[] }> {
  assertDurationRangeAllowed(input);
  const book = await getBook(input.bookId);
  const lessons = await loadLessonsForNewVideos(book.id, input.lessonIds);
  const pace = input.pace ?? getAppConfig().video.defaultPace;
  const records = await createVideoRecords(
    lessons.map(({ lesson, snapshot }) => ({
      bookId: book.id,
      title: lesson.title.slice(0, MAX_VIDEO_TITLE),
      description: null,
      range: { minDurationSec: input.minDurationSec, maxDurationSec: input.maxDurationSec },
      pace,
      lessons: [{ lessonId: lesson.id, snapshot }],
    })),
  );
  return { videos: records.map(({ id, title }) => ({ id, title })) };
}

// A new range keeps the AI's proposed length when it still fits, and otherwise moves it to the nearest end of the range.
export async function updateVideo(id: string, input: UpdateVideoInput): Promise<VideoDetail> {
  assertDurationRangeAllowed(input);
  const video = await requireVideo(id);
  await assertScriptNotGenerating(id);
  const range = { minDurationSec: input.minDurationSec, maxDurationSec: input.maxDurationSec };
  const pace = input.pace ?? toPace(video.pace);
  await updateVideoMetadata(id, {
    title: input.title,
    description: input.description,
    ...range,
    pace,
    targetDurationSec: clampToRange(video.targetDurationSec, range),
    platformPreviewMode: input.platformPreviewMode,
  });
  if (pace !== toPace(video.pace)) await reestimateScenesWithoutAudio(id, video.scenes, syllablesPerSecond(pace));
  return getVideo(id);
}

// A scene without audio is as long as its narration is estimated to take, which depends on how fast it will be voiced.
async function reestimateScenesWithoutAudio(
  videoId: string,
  scenes: readonly { id: string; narration: string; audioAssetId: string | null }[],
  rate: number,
): Promise<void> {
  const estimates = scenes
    .filter((scene) => scene.audioAssetId === null)
    .map((scene) => {
      const estimatedSeconds = estimateNarrationSeconds(scene.narration, rate);
      return { sceneId: scene.id, estimatedSeconds, durationFrames: secondsToFrames(estimatedSeconds) };
    });
  if (estimates.length > 0) await setSceneEstimates(videoId, estimates);
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
  if (await isVideoInActiveProduction(videoId)) {
    throw new AppError(
      "VIDEO_IN_PRODUCTION",
      "Video đang được sản xuất tự động. Hãy đợi đợt sản xuất xong hoặc huỷ nó trước khi thay đổi video.",
      409,
    );
  }
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
