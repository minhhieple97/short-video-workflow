import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

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
  targetDurationSec: number;
  items: readonly NewProductionItem[];
}): Promise<ProductionRecord> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.productionBatch.create({
      data: {
        bookId: input.bookId,
        idempotencyKey: input.idempotencyKey,
        fingerprint: input.fingerprint,
        targetDurationSec: input.targetDurationSec,
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
                targetDurationSec: input.targetDurationSec,
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
