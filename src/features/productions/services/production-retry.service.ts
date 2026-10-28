import "server-only";

import { toJobDto } from "@/features/jobs/services/job-dto";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import {
  ensureItemJob,
  findItemRunState,
  refreshBatchStatus,
  resetItemForRetry,
} from "../repositories/production-jobs.repository";

// A failed or cancelled item resumes from its last checkpoint; an item that is still runnable but lost its job gets one.
export async function retryProductionItem(itemId: string): Promise<JobDto> {
  const state = await findItemRunState(itemId);
  if (!state) throw new NotFoundError("PRODUCTION_ITEM_NOT_FOUND", "Không tìm thấy mục sản xuất.");

  const job = (await resetItemForRetry(itemId)) ?? (await ensureItemJob(itemId))?.job;
  if (!job) {
    throw new AppError(
      "PRODUCTION_ITEM_NOT_RETRYABLE",
      "Video này đã hoàn tất hoặc đang được xử lý, không cần thử lại.",
      409,
    );
  }
  await refreshBatchStatus(state.batchId);
  return toJobDto(job);
}
