import "server-only";

import { createHash } from "node:crypto";

import { getBook } from "@/features/books/services/book.service";
import { buildLessonSnapshot } from "@/features/videos/services/lesson-snapshot-builder";
import { assertDurationRangeAllowed } from "@/features/videos/services/video.service";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { DEFAULT_PACE, type Pace } from "@/features/videos/domain/pace";
import { toBatchStatus, toItemCheckpoint, toItemStatus } from "../domain/production-status";
import {
  createProduction,
  findLessonsForProduction,
  findProductionById,
  findProductionByKey,
  type ProductionRecord,
} from "../repositories/production.repository";
import type { ProductionDto } from "../schemas/production.dto";
import type { CreateProductionInput } from "../schemas/production.schema";

const logger = createLogger("productions.request");
const MAX_VIDEO_TITLE = 200;

export function toProductionDto(record: ProductionRecord): ProductionDto {
  return {
    id: record.id,
    bookId: record.bookId,
    status: toBatchStatus(record.status),
    minDurationSec: record.minDurationSec,
    maxDurationSec: record.maxDurationSec,
    createdAt: record.createdAt.toISOString(),
    items: record.items.map((item) => ({
      id: item.id,
      lessonId: item.lessonId,
      lessonTitle: item.lesson.title,
      position: item.position,
      status: toItemStatus(item.status),
      checkpoint: toItemCheckpoint(item.checkpoint),
      videoId: item.videoId,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
    })),
  };
}

// What was asked for, in order: the selection order becomes the item order.
const fingerprintOf = (input: CreateProductionInput, pace: Pace): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        bookId: input.bookId,
        lessonIds: input.lessonIds,
        minDurationSec: input.minDurationSec,
        maxDurationSec: input.maxDurationSec,
        // Left out at the default so a request made before paces existed keeps its fingerprint.
        ...(pace === DEFAULT_PACE ? {} : { pace }),
      }),
    )
    .digest("hex");

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// The same key with the same content is the same request; the same key with different content is a mistake.
function replay(existing: ProductionRecord, fingerprint: string): { production: ProductionDto; reused: true } {
  if (existing.fingerprint !== fingerprint) {
    throw new AppError(
      "IDEMPOTENCY_KEY_REUSED",
      "Khoá chống gửi trùng này đã được dùng cho một yêu cầu khác. Hãy tạo yêu cầu mới.",
      409,
    );
  }
  return { production: toProductionDto(existing), reused: true };
}

// Records the user's selection and makes one video, with a snapshot of its lesson, for every selected lesson.
// Selecting a lesson is not approving it, so lesson statuses are left exactly as they are.
export async function requestProduction(
  input: CreateProductionInput,
): Promise<{ production: ProductionDto; reused: boolean }> {
  assertDurationRangeAllowed(input);
  const pace = input.pace ?? getAppConfig().video.defaultPace;
  const fingerprint = fingerprintOf(input, pace);
  const existing = await findProductionByKey(input.idempotencyKey);
  if (existing) return replay(existing, fingerprint);

  const book = await getBook(input.bookId);
  const lessons = await findLessonsForProduction(book.id, input.lessonIds);
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  const missing = input.lessonIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError("LESSON_NOT_IN_BOOK", "Mọi bài học phải thuộc cùng cuốn sách được chọn.", 400, {
      details: { lessonIds: missing },
    });
  }
  const archived = lessons.filter((lesson) => lesson.status === "ARCHIVED");
  if (archived.length > 0) {
    throw new AppError("LESSON_ARCHIVED", "Có bài học đã lưu trữ, không thể dùng để sản xuất video.", 409, {
      details: { lessonIds: archived.map((lesson) => lesson.id) },
    });
  }
  const unsourced = lessons.filter(
    (lesson) => !lesson.sources.some((source) => (source.sourceExcerpt ?? "").trim().length > 0),
  );
  if (unsourced.length > 0) {
    throw new AppError("LESSON_SOURCE_MISSING", "Có bài học chưa có trích đoạn nguồn trong sách.", 409, {
      details: { lessonIds: unsourced.map((lesson) => lesson.id) },
    });
  }

  const capturedAt = new Date().toISOString();
  try {
    const record = await createProduction({
      bookId: book.id,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      range: { minDurationSec: input.minDurationSec, maxDurationSec: input.maxDurationSec },
      pace,
      items: input.lessonIds.flatMap((lessonId, index) => {
        const lesson = byId.get(lessonId);
        return lesson
          ? [
              {
                lessonId,
                position: index + 1,
                videoTitle: lesson.title.slice(0, MAX_VIDEO_TITLE),
                snapshot: buildLessonSnapshot(lesson, capturedAt),
              },
            ]
          : [];
      }),
    });
    logger.info("Production requested", { productionId: record.id, bookId: book.id, items: record.items.length });
    return { production: toProductionDto(record), reused: false };
  } catch (error) {
    // Two submits with one key raced: the loser finds the winner's batch and returns it.
    if (isUniqueViolation(error)) {
      const winner = await findProductionByKey(input.idempotencyKey);
      if (winner) return replay(winner, fingerprint);
    }
    throw error;
  }
}

export async function getProduction(id: string): Promise<ProductionDto> {
  const record = await findProductionById(id);
  if (!record) throw new NotFoundError("PRODUCTION_NOT_FOUND", "Không tìm thấy đợt sản xuất.");
  return toProductionDto(record);
}
