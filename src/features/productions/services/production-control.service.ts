import "server-only";

import { findActiveJobForEntity } from "@/features/jobs/repositories/job-record.repository";
import { cancelJob } from "@/features/jobs/services/job-control.service";
import type { JobRecord } from "@/generated/prisma/client";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { cancelItems, findActiveItemJob, refreshBatchStatus } from "../repositories/production-jobs.repository";
import { findProductionById } from "../repositories/production.repository";
import type { ProductionDto } from "../schemas/production.dto";
import { toProductionDto } from "./production-request.service";
import { retryProductionItem } from "./production-retry.service";

const logger = createLogger("productions.control");

async function requireProduction(productionId: string, itemId?: string) {
  const production = await findProductionById(productionId);
  if (!production) throw new NotFoundError("PRODUCTION_NOT_FOUND", "Không tìm thấy đợt sản xuất.");
  if (itemId && !production.items.some((item) => item.id === itemId)) {
    throw new NotFoundError("PRODUCTION_ITEM_NOT_FOUND", "Không tìm thấy video này trong đợt sản xuất.");
  }
  return production;
}

async function reload(productionId: string): Promise<ProductionDto> {
  return toProductionDto(await requireProduction(productionId));
}

// The item is already cancelled, which is what stops it; stopping its jobs only frees the worker sooner. A job that cannot
// be stopped now (Redis unreachable) skips the item when it runs, so the failure is logged rather than undoing the cancel.
async function stopJob(job: JobRecord | null, itemId: string): Promise<void> {
  if (!job || job.status === "CANCEL_REQUESTED") return;
  try {
    await cancelJob(job.id);
  } catch (error) {
    logger.warn("Could not stop a job of a cancelled item", {
      itemId,
      jobId: job.id,
      error: toSafeErrorMessage(error),
    });
  }
}

// Cancels one video of the batch, or every video that has not finished. A render already queued for it is stopped too.
export async function cancelProduction(productionId: string, itemId?: string): Promise<ProductionDto> {
  await requireProduction(productionId, itemId);
  const cancelled = await cancelItems({ batchId: productionId, itemId });
  for (const item of cancelled) {
    await stopJob(await findActiveItemJob(item.id), item.id);
    if (item.renderId) await stopJob(await findActiveJobForEntity("RENDER_VIDEO", "RENDER", item.renderId), item.id);
  }
  await refreshBatchStatus(productionId);
  logger.info("Production cancelled", { productionId, itemId, cancelled: cancelled.length });
  return reload(productionId);
}

// Retries one video, or every failed or cancelled video of the batch, each from where it stopped.
export async function retryProduction(productionId: string, itemId?: string): Promise<ProductionDto> {
  const production = await requireProduction(productionId, itemId);
  const targets = itemId
    ? [itemId]
    : production.items.filter((item) => item.status === "FAILED" || item.status === "CANCELLED").map((item) => item.id);
  if (targets.length === 0) {
    throw new AppError("PRODUCTION_NOTHING_TO_RETRY", "Không có video nào lỗi hoặc đã huỷ để thử lại.", 409);
  }
  for (const target of targets) await retryProductionItem(target);
  logger.info("Production retried", { productionId, itemId, items: targets.length });
  return reload(productionId);
}
