import "server-only";

import { archiveFolderUrl, archiveVideoUrl, toArchiveStatus } from "@/features/archive/domain/archive-labels";
import { NotFoundError } from "@/shared/errors";
import { loadPage, mapPage, type Page, type PageRequest } from "@/shared/pagination";

import { CORRECTION_LABELS } from "../domain/production-labels";
import {
  isTerminalItemStatus,
  ITEM_STATUSES,
  toBatchStatus,
  toItemCheckpoint,
  toItemStatus,
  type ItemStatus,
} from "../domain/production-status";
import {
  countProductionBatches,
  findProductionView,
  listProductionBatches,
} from "../repositories/production.repository";
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
      proposedDuration: item.video?.durationReason
        ? { seconds: item.video.targetDurationSec, reason: item.video.durationReason }
        : null,
      status,
      checkpoint: toItemCheckpoint(item.checkpoint),
      reason: reasonFor(item, status, render),
      correction: item.aiCorrectionTarget ? (CORRECTION_LABELS[item.aiCorrectionTarget] ?? null) : null,
      render: item.renderId && render ? { id: item.renderId, status: render } : null,
      archive: archive
        ? {
            status: archive.status,
            folderUrl: archiveFolderUrl(archive.status, archive.remoteFolderId),
            videoUrl: archiveVideoUrl(archive.files[0]),
          }
        : null,
      canRetry: status === "FAILED" || status === "CANCELLED",
      canCancel: !isTerminalItemStatus(status),
    };
  });

  return {
    id: batch.id,
    book: batch.book,
    status: toBatchStatus(batch.status),
    minDurationSec: batch.minDurationSec,
    maxDurationSec: batch.maxDurationSec,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    inProgress: items.some((item) => !isTerminalItemStatus(item.status)),
    archiving: items.some((item) => item.archive !== null && ARCHIVING.has(toArchiveStatus(item.archive.status))),
    counts,
    items,
  };
}

function toProductionSummary(batch: Awaited<ReturnType<typeof listProductionBatches>>[number]): ProductionSummaryDto {
  return {
    id: batch.id,
    book: batch.book,
    status: toBatchStatus(batch.status),
    minDurationSec: batch.minDurationSec,
    maxDurationSec: batch.maxDurationSec,
    itemCount: batch.items.length,
    completedCount: batch.items.filter((item) => item.status === "COMPLETED").length,
    createdAt: batch.createdAt.toISOString(),
  };
}

export async function listProductions(): Promise<ProductionSummaryDto[]> {
  return (await listProductionBatches()).map(toProductionSummary);
}

export async function listProductionsPage(request: PageRequest): Promise<Page<ProductionSummaryDto>> {
  const records = await loadPage(request, { count: countProductionBatches, fetch: listProductionBatches });
  return mapPage(records, toProductionSummary);
}
