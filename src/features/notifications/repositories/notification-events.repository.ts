import { randomUUID } from "node:crypto";

import type { JobRecord, Prisma } from "@/generated/prisma/client";
import { productionStep } from "@/features/productions/domain/production-labels";
import { toItemCheckpoint } from "@/features/productions/domain/production-status";
import { getAppConfig } from "@/shared/config/env";
import { readStoredRenderSnapshot } from "@/features/videos/domain/render-snapshot";

import type { NotificationFailure } from "../domain/notification-failure";
import { recordNotificationWithin } from "./notification.repository";

type Tx = Prisma.TransactionClient;
const enabled = () => getAppConfig().telegram.enabled;
const errorFields = (failure: NotificationFailure) =>
  [
    ["Mã lỗi", failure.code],
    ["Chi tiết", failure.message],
    ["Scene ID", failure.sceneId],
  ] as const;

export async function notifyProductionFailureWithin(
  tx: Tx,
  itemId: string,
  failure: NotificationFailure,
): Promise<void> {
  if (!enabled()) return;
  const item = await tx.productionItem.findUnique({
    where: { id: itemId },
    include: { video: { include: { book: true } }, batch: { select: { book: { select: { id: true, title: true } } } } },
  });
  if (!item) return;
  const job = await tx.jobRecord.findFirst({
    where: { entityType: "PRODUCTION_ITEM", entityId: itemId },
    orderBy: { createdAt: "desc" },
  });
  await recordNotificationWithin(tx, {
    eventKey: `production-failed:${itemId}:${randomUUID()}`,
    book: item.video?.book ?? item.batch.book,
    kind: "PIPELINE_FAILED",
    title: "❌ Tạo video bị dừng",
    fields: [
      ["Sách", item.video?.book.title],
      ["Video", item.video?.title],
      ["Bước", failure.stage ?? productionStep(toItemCheckpoint(item.checkpoint)).label],
      ...errorFields(failure),
      ["Đã thử lại", item.transientRetries],
      ["Video ID", item.videoId],
      ["Production item ID", itemId],
      ["Job ID", job?.id],
    ],
  });
}

export async function notifyExtractionFailureWithin(
  tx: Tx,
  extractionId: string,
  failure: NotificationFailure,
): Promise<void> {
  if (!enabled()) return;
  const extraction = await tx.bookExtraction.findUnique({ where: { id: extractionId }, include: { book: true } });
  if (!extraction) return;
  const job = await tx.jobRecord.findFirst({
    where: { entityType: "EXTRACTION", entityId: extractionId },
    orderBy: { createdAt: "desc" },
  });
  await recordNotificationWithin(tx, {
    eventKey: `extraction-stopped:${extractionId}:${randomUUID()}`,
    book: extraction.book,
    kind: "PIPELINE_FAILED",
    title: "❌ Nhập PDF cần xử lý",
    fields: [
      ["Sách", extraction.book.title],
      ["Bước", failure.stage ?? "Trích xuất PDF / OCR / chia chương"],
      ...errorFields(failure),
      ["Đã thử lại", extraction.transientFailures],
      ["Book ID", extraction.bookId],
      ["Extraction ID", extractionId],
      ["Job ID", job?.id],
    ],
  });
}

export async function notifyArchiveFailureWithin(
  tx: Tx,
  archiveId: string,
  failure: NotificationFailure,
): Promise<void> {
  if (!enabled()) return;
  const archive = await tx.renderArchive.findUnique({
    where: { id: archiveId },
    include: { render: { include: { video: { include: { book: true } } } } },
  });
  // A draft's archive is shown in the render history; only a FINAL video is worth a message.
  if (!archive || archive.render.qualityPreset !== "FINAL") return;
  const job = await tx.jobRecord.findFirst({
    where: { entityType: "ARCHIVE", entityId: archiveId },
    orderBy: { createdAt: "desc" },
  });
  await recordNotificationWithin(tx, {
    eventKey: `archive-failed:${archiveId}:${randomUUID()}`,
    book: archive.render.video.book,
    kind: "PIPELINE_FAILED",
    title: "❌ Lưu Google Drive thất bại — video đã render thành công",
    fields: [
      ["Sách", archive.render.video.book.title],
      ["Video", archive.render.video.title],
      ["Bước", "Lưu Google Drive"],
      ...errorFields(failure),
      ["Đã thử lại", archive.retries],
      ["Video ID", archive.render.videoId],
      ["Render ID", archive.renderId],
      ["Archive ID", archiveId],
      ["Job ID", job?.id],
    ],
  });
}

export async function notifyVideoReadyWithin(tx: Tx, archiveId: string): Promise<void> {
  if (!enabled()) return;
  const archive = await tx.renderArchive.findUnique({
    where: { id: archiveId },
    include: { files: true, render: { include: { video: { include: { book: true } } } } },
  });
  const file = archive?.files.find(
    (entry) => entry.kind === "VIDEO" && entry.status === "VERIFIED" && entry.remoteFileId,
  );
  if (
    !archive ||
    archive.status !== "COMPLETED" ||
    archive.render.qualityPreset !== "FINAL" ||
    archive.render.status !== "COMPLETED" ||
    !file?.remoteFileId
  )
    return;
  const snapshot = readStoredRenderSnapshot(archive.render.snapshotJson, archive.render.snapshotHash);
  await recordNotificationWithin(tx, {
    eventKey: `video-ready:${archive.renderId}`,
    book: { id: archive.render.video.bookId, title: snapshot?.video.bookTitle ?? archive.render.video.book.title },
    kind: "VIDEO_READY",
    title: "✅ Video đã sẵn sàng",
    fields: [
      ["Sách", snapshot?.video.bookTitle ?? archive.render.video.book.title],
      ["Video", snapshot?.video.title ?? archive.render.video.title],
      ["Thời lượng (giây)", Math.round((archive.render.durationMs ?? 0) / 100) / 10],
      ["Video ID", archive.render.videoId],
      ["Render ID", archive.renderId],
    ],
    videoUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.remoteFileId)}/view`,
  });
}

export async function notifyMissingDriveWithin(tx: Tx, renderId: string): Promise<void> {
  if (!enabled()) return;
  const render = await tx.renderRecord.findUnique({
    where: { id: renderId },
    include: { video: { include: { book: true } } },
  });
  if (!render || render.status !== "COMPLETED" || render.qualityPreset !== "FINAL") return;
  const snapshot = readStoredRenderSnapshot(render.snapshotJson, render.snapshotHash);
  await recordNotificationWithin(tx, {
    eventKey: `video-missing-drive:${renderId}`,
    book: { id: render.video.bookId, title: snapshot?.video.bookTitle ?? render.video.book.title },
    kind: "VIDEO_LINK_UNAVAILABLE",
    title: "⚠️ Video đã render ở local, chưa có link Drive",
    fields: [
      ["Sách", snapshot?.video.bookTitle ?? render.video.book.title],
      ["Video", snapshot?.video.title ?? render.video.title],
      ["Bước", "Lưu Google Drive"],
      ["Chi tiết", "Kết nối lại Google Drive trong Cài đặt; bản render được giữ nguyên để lưu tiếp."],
      ["Video ID", render.videoId],
      ["Render ID", render.id],
    ],
  });
}

const JOB_STAGES: Record<string, string> = {
  ANALYZE_CHAPTER: "Phân tích bài học",
  GENERATE_VIDEO_SCRIPT: "Viết kịch bản",
  GENERATE_PUBLISH_METADATA: "Viết thông tin đăng tải",
  GENERATE_SCENE_TTS: "Lồng tiếng",
  RENDER_VIDEO: "Render video",
  EXTRACT_PDF: "Trích xuất PDF / OCR / chia chương",
  RUN_PRODUCTION_ITEM: "Sản xuất video",
  ARCHIVE_RENDER: "Lưu Google Drive",
};

export async function notifyJobFailureWithin(tx: Tx, job: JobRecord, sceneId?: string): Promise<void> {
  if (!enabled() || job.jobType === "DIAGNOSTIC_PING") return;
  if (
    job.entityType === "PRODUCTION_ITEM" &&
    (await tx.productionItem.count({ where: { id: job.entityId, status: "FAILED" } }))
  )
    return;
  if (job.entityType === "ARCHIVE" && (await tx.renderArchive.count({ where: { id: job.entityId, status: "FAILED" } })))
    return;
  if (
    job.entityType === "EXTRACTION" &&
    (await tx.bookExtraction.count({ where: { id: job.entityId, errorCode: { not: null } } }))
  )
    return;
  const render = job.entityType === "RENDER" ? await tx.renderRecord.findUnique({ where: { id: job.entityId } }) : null;
  if (render && (await tx.productionItem.count({ where: { renderId: render.id } }))) return;
  const scene = job.entityType === "SCENE" ? await tx.videoScene.findUnique({ where: { id: job.entityId } }) : null;
  const videoId = render?.videoId ?? scene?.videoId ?? (job.entityType === "VIDEO" ? job.entityId : undefined);
  const video = videoId ? await tx.video.findUnique({ where: { id: videoId }, include: { book: true } }) : null;
  const chapter =
    job.entityType === "CHAPTER"
      ? await tx.chapter.findUnique({ where: { id: job.entityId }, include: { book: true } })
      : null;
  const extraction =
    job.entityType === "EXTRACTION"
      ? await tx.bookExtraction.findUnique({ where: { id: job.entityId }, include: { book: true } })
      : null;
  const production =
    job.entityType === "PRODUCTION_ITEM"
      ? await tx.productionItem.findUnique({
          where: { id: job.entityId },
          include: { batch: { include: { book: true } } },
        })
      : null;
  const archive =
    job.entityType === "ARCHIVE"
      ? await tx.renderArchive.findUnique({
          where: { id: job.entityId },
          include: { render: { include: { video: { include: { book: true } } } } },
        })
      : null;
  const book = video?.book ?? chapter?.book ?? extraction?.book ?? production?.batch.book ?? archive?.render.video.book;
  await recordNotificationWithin(tx, {
    eventKey: `job-failed:${job.id}:${job.attempts}`,
    book,
    kind: "PIPELINE_FAILED",
    title: "❌ Tác vụ bị dừng",
    fields: [
      ["Sách", video?.book.title ?? chapter?.book.title],
      ["Chương", chapter?.title],
      ["Video", video?.title],
      ["Bước", JOB_STAGES[job.jobType] ?? job.jobType],
      ...errorFields({
        code: job.errorCode ?? "PROCESSOR_ERROR",
        message: job.errorMessage ?? "Tác vụ thất bại.",
        sceneId: sceneId ?? scene?.id,
      }),
      ["Đã thử lại", Math.max(0, job.attempts - 1) + job.transientFailures],
      ["Job ID", job.id],
      ["Video ID", videoId],
      ["Entity ID", job.entityId],
    ],
  });
}
