import { randomUUID } from "node:crypto";

import { createJobIntentWithin } from "@/features/jobs/repositories/job-dispatch.repository";
import type { JobRecord, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { ACTIVE_JOB_STATUSES } from "@/shared/types/job";

import { deriveBatchStatus, isTerminalItemStatus, toItemStatus } from "../domain/production-status";

type Tx = Prisma.TransactionClient;

export const PRODUCTION_ITEM_ENTITY = "PRODUCTION_ITEM";
const RUNNABLE_STATUSES = ["PENDING", "WAITING", "RUNNING"];

// Every change that makes an item runnable starts its job in the same transaction, so an item never waits for a job that
// was not recorded. The outbox delivers it.
export async function startItemJobWithin(tx: Tx, itemId: string): Promise<JobRecord> {
  const intent = await createJobIntentWithin(tx, {
    bullmqJobId: randomUUID(),
    jobType: "RUN_PRODUCTION_ITEM",
    entityType: PRODUCTION_ITEM_ENTITY,
    entityId: itemId,
    payload: { itemId },
  });
  return intent.jobRecord;
}

export function findActiveItemJob(itemId: string, tx: Tx = prisma): Promise<JobRecord | null> {
  return tx.jobRecord.findFirst({
    where: {
      jobType: "RUN_PRODUCTION_ITEM",
      entityType: PRODUCTION_ITEM_ENTITY,
      entityId: itemId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Gives a runnable item a job when it has none (its job was lost or failed outside the pipeline). The first statement
// writes the item, which takes SQLite's write lock, so two callers cannot both find no job and start one each.
export function ensureItemJob(itemId: string): Promise<{ job: JobRecord; started: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.productionItem.updateMany({
      where: { id: itemId, status: { in: RUNNABLE_STATUSES } },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return null;
    const active = await findActiveItemJob(itemId, tx);
    if (active) return { job: active, started: false };
    return { job: await startItemJobWithin(tx, itemId), started: true };
  });
}

// A failed or cancelled item resumes from its checkpoint. The correction budget stays spent; the render link is dropped
// so a failed render is not looked at again (a completed one for the same script is reused when the render step asks).
export function resetItemForRetry(itemId: string): Promise<JobRecord | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.productionItem.updateMany({
      where: { id: itemId, status: { in: ["FAILED", "CANCELLED"] }, claimToken: null },
      data: {
        status: "PENDING",
        errorCode: null,
        errorMessage: null,
        completedAt: null,
        transientRetries: 0,
        renderId: null,
      },
    });
    return count > 0 ? startItemJobWithin(tx, itemId) : null;
  });
}

// Marks the items cancelled; an item being worked on keeps its claim and its holder stops before the next step.
export function cancelItems(where: {
  batchId: string;
  itemId?: string;
}): Promise<{ id: string; renderId: string | null }[]> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.productionItem.findMany({
      where: { batchId: where.batchId, id: where.itemId, status: { in: RUNNABLE_STATUSES } },
      select: { id: true, renderId: true },
    });
    await tx.productionItem.updateMany({
      where: { id: { in: items.map((item) => item.id) }, status: { in: RUNNABLE_STATUSES } },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    return items;
  });
}

// Used when an item's job is cancelled from the jobs page: cancelling the job cancels that video's production.
export async function cancelItem(itemId: string): Promise<string | null> {
  const item = await prisma.productionItem.findUnique({ where: { id: itemId }, select: { batchId: true } });
  if (!item) return null;
  const { count } = await prisma.productionItem.updateMany({
    where: { id: itemId, status: { in: RUNNABLE_STATUSES } },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  return count > 0 ? item.batchId : null;
}

export function listRunnableItemIds(): Promise<string[]> {
  return prisma.productionItem
    .findMany({ where: { status: { in: RUNNABLE_STATUSES } }, select: { id: true }, orderBy: { createdAt: "asc" } })
    .then((items) => items.map((item) => item.id));
}

export function findItemRunState(itemId: string) {
  return prisma.productionItem.findUnique({
    where: { id: itemId },
    select: { status: true, claimExpiresAt: true, batchId: true },
  });
}

// The batch status is a read model of its items; it is recomputed from them whenever one of them changes status.
export function refreshBatchStatus(batchId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.productionBatch.findUnique({
      where: { id: batchId },
      select: { completedAt: true, items: { select: { status: true } } },
    });
    if (!batch) return;
    const statuses = batch.items.map((item) => toItemStatus(item.status));
    const finished = statuses.length > 0 && statuses.every(isTerminalItemStatus);
    await tx.productionBatch.update({
      where: { id: batchId },
      data: {
        status: deriveBatchStatus(statuses),
        completedAt: finished ? (batch.completedAt ?? new Date()) : null,
      },
    });
  });
}
