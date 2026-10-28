import { runExtraction } from "@/features/extraction/services/extraction-run.service";
import { extractPdfPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { AppError } from "@/shared/errors";

import { deferred, type JobProcessor } from "./types";

// Takes a PDF book from its original file to chapters. A pending OCR batch or a temporary failure ends the job as
// deferred, so the worker is never held while a batch runs; a stop the run cannot get past by itself fails the job
// with the reason that is also stored on the run.
export const processExtractPdf: JobProcessor = async ({ job, signal }) => {
  const { extractionId } = extractPdfPayloadSchema.parse(job.data);
  const outcome = await runExtraction(extractionId, undefined, signal);
  switch (outcome.kind) {
    case "WAITING":
      return deferred(outcome.retryAfterMs);
    case "STOPPED":
      throw new AppError(outcome.code, outcome.message, 422);
    default:
      return { extractionId, outcome: outcome.kind };
  }
};
