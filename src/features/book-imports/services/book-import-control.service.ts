import "server-only";

import { cancelJob } from "@/features/jobs/services/job-control.service";
import { AppError } from "@/shared/errors";

import { cancelBookImportRecord, retryBookImportRecord } from "../repositories/book-import.repository";
import { getBookImport, requireBookImport } from "./book-import.service";

export async function controlBookImport(id: string, action: "cancel" | "retry") {
  const batch = await requireBookImport(id);
  if (action === "retry") {
    await retryBookImportRecord(id);
  } else {
    if (["COMPLETED", "PARTIAL"].includes(batch.status))
      throw new AppError("BOOK_IMPORT_FINISHED", "Đợt nhập đã kết thúc.", 409);
    for (const jobId of await cancelBookImportRecord(id)) {
      try {
        await cancelJob(jobId);
      } catch (error) {
        if (!(error instanceof AppError && error.code === "JOB_NOT_CANCELLABLE")) throw error;
      }
    }
  }
  return getBookImport(id);
}
