import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { AppError } from "@/shared/errors";

import { startItemJobWithin } from "./production-jobs.repository";

const WITH_ITEMS = {
  items: { orderBy: { position: "asc" }, include: { lesson: { select: { title: true } } } },
} as const satisfies Prisma.ProductionBatchInclude;

export type ProductionRecord = Prisma.ProductionBatchGetPayload<{ include: typeof WITH_ITEMS }>;

export function findProductionById(id: string): Promise<ProductionRecord | null> {
  return prisma.productionBatch.findUnique({ where: { id }, include: WITH_ITEMS });
}

export function findProductionByKey(idempotencyKey: string): Promise<ProductionRecord | null> {
  return prisma.productionBatch.findUnique({ where: { idempotencyKey }, include: WITH_ITEMS });
}

// Everything the progress page shows for one batch, in three queries: the batch with its items, their renders, and the
// renders' archives.
export async function findProductionView(id: string) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: {
      book: { select: { id: true, title: true } },
      items: {
        orderBy: { position: "asc" },
        include: {
          lesson: { select: { title: true } },
          video: { select: { id: true, title: true, targetDurationSec: true, durationReason: true } },
        },
      },
    },
  });
  if (!batch) return null;
  const renderIds = batch.items.flatMap((item) => (item.renderId ? [item.renderId] : []));
  const [renders, archives] = await Promise.all([
    prisma.renderRecord.findMany({ where: { id: { in: renderIds } }, select: { id: true, status: true } }),
    prisma.renderArchive.findMany({
      where: { renderId: { in: renderIds } },
      orderBy: { createdAt: "desc" },
      select: { renderId: true, status: true, remoteFolderId: true },
    }),
  ]);
  return { batch, renders, archives };
}

// The production a video was made in, if any (a video belongs to at most one item).
export function findProductionItemForVideo(videoId: string) {
  return prisma.productionItem.findUnique({
    where: { videoId },
    select: {
      batchId: true,
      status: true,
      checkpoint: true,
      aiCorrectionTarget: true,
      draftArtifactJson: true,
      scenePlanArtifactJson: true,
    },
  });
}

export function listProductionBatches(limit = 50) {
  return prisma.productionBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { book: { select: { id: true, title: true } }, items: { select: { status: true } } },
  });
}

// The lessons a book offers for production, with the source excerpts that back them. Archived lessons are not offered.
export function findCatalogueLessons(bookId: string) {
  return prisma.lesson.findMany({
    where: { bookId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" },
    include: {
      sources: { include: { chapter: { select: { title: true, order: true } } } },
      _count: { select: { videoLessons: true } },
    },
  });
}

export function findLessonsForProduction(bookId: string, lessonIds: readonly string[]) {
  return prisma.lesson.findMany({
    where: { id: { in: [...lessonIds] }, bookId },
    include: { sources: { include: { chapter: { select: { id: true, title: true } } } } },
  });
}

export interface NewProductionItem {
  lessonId: string;
  position: number;
  videoTitle: string;
  snapshot: Prisma.InputJsonObject;
}

// The batch, one item per lesson, one video (with its lesson snapshot) per item and each item's job are written in one
// transaction: either the whole request exists or none of it does, so a retry can never find half of one.
export function createProduction(input: {
  bookId: string;
  idempotencyKey: string;
  fingerprint: string;
  range: { minDurationSec: number; maxDurationSec: number };
  pace: string;
  items: readonly NewProductionItem[];
  importItemId?: string;
}): Promise<ProductionRecord> {
  return prisma.$transaction(async (tx) => {
    if (input.importItemId) {
      const active = await tx.bookImportItem.updateMany({
        where: { id: input.importItemId, bookId: input.bookId, batch: { status: { in: ["QUEUED", "RUNNING"] } } },
        data: { updatedAt: new Date() },
      });
      if (!active.count) throw new AppError("BOOK_IMPORT_STOPPED", "Đợt nhập đã dừng.", 409);
    }
    const batch = await tx.productionBatch.create({
      data: {
        importItemId: input.importItemId,
        bookId: input.bookId,
        idempotencyKey: input.idempotencyKey,
        fingerprint: input.fingerprint,
        ...input.range,
        pace: input.pace,
        targetDurationSec: input.range.maxDurationSec,
        status: "QUEUED",
        items: {
          create: input.items.map((item) => ({
            lesson: { connect: { id: item.lessonId } },
            position: item.position,
            status: "PENDING",
            video: {
              create: {
                bookId: input.bookId,
                title: item.videoTitle,
                ...input.range,
                pace: input.pace,
                // NotebookLM proposes the length when it writes the draft; until then the plan is the maximum.
                targetDurationSec: input.range.maxDurationSec,
                status: "DRAFT",
                videoLessons: {
                  create: [{ lessonId: item.lessonId, position: 1, lessonSnapshotJson: item.snapshot }],
                },
              },
            },
          })),
        },
      },
      include: WITH_ITEMS,
    });
    for (const item of batch.items) await startItemJobWithin(tx, item.id);
    return batch;
  });
}
