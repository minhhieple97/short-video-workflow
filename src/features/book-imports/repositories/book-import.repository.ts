import { randomUUID } from "node:crypto";

import { createJobIntentWithin } from "@/features/jobs/repositories/job-dispatch.repository";
import { startExtractionJobWithin } from "@/features/extraction/repositories/extraction-jobs.repository";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { AppError } from "@/shared/errors";
import { ACTIVE_JOB_STATUSES } from "@/shared/types/job";

import { FINISHED_BOOK_IMPORT_ITEMS } from "../domain/book-import-status";
import type { CreateBookImport } from "../schemas/book-import.schema";

const INCLUDE = {
  items: {
    orderBy: { position: "asc" },
    include: {
      book: {
        select: {
          id: true,
          deletedAt: true,
          extractions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true, errorCode: true, errorMessage: true },
          },
          chapters: { orderBy: { order: "asc" }, select: { id: true, title: true, analysisStatus: true } },
        },
      },
      productions: {
        include: { items: { select: { id: true, status: true, renderId: true, errorCode: true, errorMessage: true } } },
      },
    },
  },
} as const satisfies Prisma.BookImportBatchInclude;

export type BookImportRecord = Prisma.BookImportBatchGetPayload<{ include: typeof INCLUDE }>;

export function findBookImport(id: string) {
  return prisma.bookImportBatch.findUnique({ where: { id }, include: INCLUDE });
}

export function findBookImportByKey(idempotencyKey: string) {
  return prisma.bookImportBatch.findUnique({ where: { idempotencyKey }, include: INCLUDE });
}

export function createBookImport(input: CreateBookImport & { fingerprint: string; pace: string }) {
  const { fileNames, ...settings } = input;
  return prisma.bookImportBatch.create({
    data: {
      ...settings,
      items: { create: fileNames.map((fileName, index) => ({ fileName, position: index + 1 })) },
    },
    include: INCLUDE,
  });
}

export function listBookImports() {
  return prisma.bookImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: INCLUDE });
}

export function findNextBookImport() {
  return prisma.bookImportBatch.findFirst({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    include: INCLUDE,
  });
}

export function startBookImport(id: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.bookImportBatch.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (batch.status !== "UPLOADING") return;
    if (batch.items.some((item) => !item.bookId && item.status !== "FAILED"))
      throw new AppError("BOOK_IMPORT_INCOMPLETE", "Hãy tải đủ tệp trước khi bắt đầu.", 409);
    if (!batch.items.some((item) => item.bookId))
      throw new AppError("BOOK_IMPORT_EMPTY", "Chưa có sách hợp lệ để xử lý.", 409);
    await tx.bookImportBatch.update({ where: { id }, data: { status: "QUEUED" } });
  });
}

export async function rejectBookImportUpload(itemId: string, error: { code: string; message: string }): Promise<void> {
  await prisma.bookImportItem.updateMany({
    where: { id: itemId, bookId: null, batch: { status: "UPLOADING" } },
    data: {
      status: "FAILED",
      errorCode: error.code,
      errorMessage: error.message,
    },
  });
}

export async function setBookImportItem(
  id: string,
  status: string,
  error?: { code: string; message: string },
): Promise<void> {
  await prisma.bookImportItem.updateMany({
    where: { id, batch: { status: { in: ["QUEUED", "RUNNING"] } } },
    data: {
      status,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    },
  });
}

export async function finishBookImport(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const batch = await tx.bookImportBatch.findUniqueOrThrow({ where: { id }, include: { items: true } });
    if (batch.status === "CANCELLED" || !batch.items.every((item) => FINISHED_BOOK_IMPORT_ITEMS.includes(item.status)))
      return;
    await tx.bookImportBatch.update({
      where: { id },
      data: {
        status: batch.items.every((item) => item.status === "COMPLETED") ? "COMPLETED" : "PARTIAL",
      },
    });
  });
}

export async function activateBookExtraction(itemId: string, extractionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const item = await tx.bookImportItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true } });
    if (!["QUEUED", "RUNNING"].includes(item.batch.status)) return;
    const changed = await tx.bookExtraction.updateMany({
      where: { id: extractionId, status: "STAGED" },
      data: { status: "QUEUED" },
    });
    if (changed.count) await startExtractionJobWithin(tx, extractionId);
    await tx.bookImportItem.update({ where: { id: itemId }, data: { status: "EXTRACTING" } });
    await tx.bookImportBatch.update({ where: { id: item.batchId }, data: { status: "RUNNING" } });
  });
}

export async function queueImportedChapter(itemId: string, chapterId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const item = await tx.bookImportItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true } });
    if (!["QUEUED", "RUNNING"].includes(item.batch.status)) return;
    const chapter = await tx.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    if (chapter.bookId !== item.bookId || chapter.analysisStatus === "ANALYZED") return;
    const active = await tx.jobRecord.findFirst({
      where: {
        entityType: "CHAPTER",
        entityId: chapterId,
        jobType: "ANALYZE_CHAPTER",
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
    });
    if (active) return;
    await tx.chapter.update({ where: { id: chapterId }, data: { analysisStatus: "QUEUED" } });
    await createJobIntentWithin(tx, {
      bullmqJobId: randomUUID(),
      jobType: "ANALYZE_CHAPTER",
      entityType: "CHAPTER",
      entityId: chapterId,
      payload: { chapterId, force: false },
    });
  });
}

export function listImportedLessonIds(bookId: string) {
  return prisma.lesson.findMany({
    where: { bookId, status: { not: "ARCHIVED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
}

export function findImportArchives(renderIds: string[]) {
  return prisma.renderArchive.findMany({ where: { renderId: { in: renderIds } }, orderBy: { createdAt: "desc" } });
}

export function findLatestImportChapterJob(chapterId: string) {
  return prisma.jobRecord.findFirst({
    where: { entityType: "CHAPTER", entityId: chapterId, jobType: "ANALYZE_CHAPTER" },
    orderBy: { createdAt: "desc" },
  });
}

export async function cancelBookImportRecord(id: string): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.bookImportBatch.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.bookImportItem.updateMany({
      where: { batchId: id, status: { notIn: ["COMPLETED", "FAILED"] } },
      data: { status: "CANCELLED" },
    });
    const items = await tx.bookImportItem.findMany({
      where: { batchId: id },
      include: {
        book: { include: { chapters: true, extractions: true } },
        productions: { include: { items: true } },
      },
    });
    const entities = items.flatMap((item) => [
      ...(item.book?.chapters.map((chapter) => chapter.id) ?? []),
      ...(item.book?.extractions.map((extraction) => extraction.id) ?? []),
      ...item.productions.flatMap((production) =>
        production.items.flatMap((video) => [video.id, ...(video.renderId ? [video.renderId] : [])]),
      ),
    ]);
    const renders = items.flatMap((item) =>
      item.productions.flatMap((production) =>
        production.items.flatMap((video) => (video.renderId ? [video.renderId] : [])),
      ),
    );
    const archives = await tx.renderArchive.findMany({ where: { renderId: { in: renders } }, select: { id: true } });
    const jobs = await tx.jobRecord.findMany({
      where: {
        entityId: { in: [...entities, ...archives.map((archive) => archive.id)] },
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
      select: { id: true },
    });
    return jobs.map((job) => job.id);
  });
}

export async function retryBookImportRecord(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const batch = await tx.bookImportBatch.findUniqueOrThrow({ where: { id } });
    if (batch.status !== "PARTIAL")
      throw new AppError("BOOK_IMPORT_NOT_RETRYABLE", "Đợi đợt nhập kết thúc trước khi thử lại sách lỗi.", 409);
    await tx.bookImportItem.updateMany({
      where: { batchId: id, status: "FAILED", bookId: { not: null } },
      data: { status: "QUEUED", errorCode: null, errorMessage: null },
    });
    await tx.bookImportBatch.update({ where: { id }, data: { status: "QUEUED" } });
  });
}
