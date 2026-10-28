import "server-only";

import { toJobDto } from "@/features/jobs/services/job-dto";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { resetExtractionForRetry } from "../repositories/extraction-jobs.repository";

// Starts the extraction again from where it stopped; a run that is already being processed keeps its job.
export async function retryExtraction(extractionId: string): Promise<JobDto> {
  const result = await resetExtractionForRetry(extractionId);
  switch (result.kind) {
    case "missing":
      throw new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");
    case "not_retryable":
      throw new AppError(
        "EXTRACTION_NOT_RETRYABLE",
        result.status === "COMPLETED"
          ? "Lần trích xuất này đã hoàn tất, không cần thử lại."
          : "Lần trích xuất này không thể thử lại ở trạng thái hiện tại.",
        409,
      );
    default:
      return toJobDto(result.job);
  }
}
