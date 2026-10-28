import "server-only";

import { archiveFolderUrl, toArchiveStatus } from "@/features/archive/domain/archive-labels";
import { NotFoundError } from "@/shared/errors";

import { CORRECTION_LABELS } from "../domain/production-labels";
import {
  isTerminalItemStatus,
  ITEM_STATUSES,
  toBatchStatus,
  toItemCheckpoint,
  toItemStatus,
  type ItemStatus,
} from "../domain/production-status";
import { findProductionView, listProductionBatches } from "../repositories/production.repository";
import type { ProductionSummaryDto, ProductionViewDto } from "../schemas/production-view.dto";

type ViewRecord = NonNullable<Awaited<ReturnType<typeof findProductionView>>>;
type ItemRecord = ViewRecord["batch"]["items"][number];

function reasonFor(item: ItemRecord, status: ItemStatus, renderStatus: string | undefined): string | null {
  if (status === "FAILED" || status === "CANCELLED") return item.errorMessage;
  if (status !== "WAITING" && status !== "RUNNING") return null;
  if (item.errorMessage) return `${item.errorMessage} (đã thử ${item.transientRetries} lần)`;
  if (status === "WAITING" && renderStatus) return "Đang chờ worker render bản cuối.";
  return null;
}

// The progress of one production, read from the database only: the page never asks a worker or a remote service.
const ARCHIVING = new Set(["PENDING", "RUNNING", "WAITING"]);

export async function getProductionView(productionId: string): Promise<ProductionViewDto> {
  const view = await findProductionView(productionId);
  if (!view) throw new NotFoundError("PRODUCTION_NOT_FOUND", "Không tìm thấy đợt sản xuất.");
  const { batch, renders, archives } = view;
  const renderStatus = new Map(renders.map((render) => [render.id, render.status]));
  const counts = Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0])) as Record<ItemStatus, number>;

  const items = batch.items.map((item) => {
    const status = toItemStatus(item.status);
    counts[status] += 1;
    const render = item.renderId ? renderStatus.get(item.renderId) : undefined;
    const archive = archives.find((entry) => entry.renderId === item.renderId);
    return {
      id: item.id,
      position: item.position,
      lessonTitle: item.lesson.title,
      videoId: item.video?.id ?? null,
      videoTitle: item.video?.title ?? null,
      status,
      checkpoint: toItemCheckpoint(item.checkpoint),
      reason: reasonFor(item, status, render),
      correction: item.aiCorrectionTarget ? (CORRECTION_LABELS[item.aiCorrectionTarget] ?? null) : null,
      render: item.renderId && render ? { id: item.renderId, status: render } : null,
      archive: archive
        ? { status: archive.status, folderUrl: archiveFolderUrl(archive.status, archive.remoteFolderId) }
        : null,
      canRetry: status === "FAILED" || status === "CANCELLED",
      canCancel: !isTerminalItemStatus(status),
    };
  });

  return {
    id: batch.id,
    book: batch.book,
    status: toBatchStatus(batch.status),
    targetDurationSec: batch.targetDurationSec,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    inProgress: items.some((item) => !isTerminalItemStatus(item.status)),
    archiving: items.some((item) => item.archive !== null && ARCHIVING.has(toArchiveStatus(item.archive.status))),
    counts,
    items,
  };
}

export async function listProductions(): Promise<ProductionSummaryDto[]> {
  return (await listProductionBatches()).map((batch) => ({
    id: batch.id,
    book: batch.book,
    status: toBatchStatus(batch.status),
    targetDurationSec: batch.targetDurationSec,
    itemCount: batch.items.length,
    completedCount: batch.items.filter((item) => item.status === "COMPLETED").length,
    createdAt: batch.createdAt.toISOString(),
  }));
}
