import {
  findRenderArchive,
  recordArchiveRetry,
  setArchiveStatus,
} from "@/features/archive/repositories/render-archive.repository";
import { currentArchiveDestination } from "@/features/archive/services/archive-request.service";
import { runRenderArchive } from "@/features/archive/services/archive-run.service";
import { createDriveArchiveProvider } from "@/features/archive/services/drive-archive-provider.factory";
import { archiveRenderPayloadSchema } from "@/features/jobs/schemas/job-payload.schema";
import { IntegrationError } from "@/server/integrations/integration-error";
import { withProviderCooldown } from "@/features/jobs/services/provider-cooldown.service";
import { AppError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import { deferred, type JobProcessor } from "./types";

// A run of the same archive that keeps failing for a temporary reason stops after this many tries, with its reason.
export const MAX_ARCHIVE_RETRIES = 8;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

export function archiveBackoffMs(retries: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, retries - 1));
}

const WAITABLE = new Set(["QUOTA", "TRANSIENT", "UNKNOWN_OUTCOME"]);

async function failArchive(archiveId: string, code: string, message: string): Promise<never> {
  await setArchiveStatus(archiveId, "FAILED", { code, message });
  throw new AppError(code, message, 422);
}

// Uploads one render's archive to the connected Drive. It only ever uploads: a Drive failure never renders, voices or calls
// an AI again. A wait (quota, outage, a lost answer) ends the job as deferred and the archive resumes from its checkpoints
// next time; a failure waiting cannot fix (permission, a full Drive, a changed file) fails the archive with its reason.
export const processArchiveRender: JobProcessor = async ({ job, signal }) => {
  const { archiveId } = archiveRenderPayloadSchema.parse(job.data);
  const archive = await findRenderArchive(archiveId);
  if (!archive || archive.status === "FAILED") return { archiveId, skipped: true };
  if (archive.status === "COMPLETED") return { archiveId, outcome: "COMPLETED" };

  const destination = await currentArchiveDestination();
  if (!destination) {
    return failArchive(archiveId, "DRIVE_RECONNECT_REQUIRED", "Google Drive chưa được kết nối hoặc cần kết nối lại.");
  }
  if (destination.destinationKey !== archive.destinationKey || destination.provider !== archive.provider) {
    return failArchive(
      archiveId,
      "ARCHIVE_DESTINATION_CHANGED",
      "Bản lưu trữ này thuộc tài khoản Google Drive khác tài khoản đang kết nối.",
    );
  }

  let outcome;
  let providerSucceeded = false;
  try {
    outcome = await withProviderCooldown(
      "drive",
      () =>
        runRenderArchive({
          archiveId,
          provider: createDriveArchiveProvider(archive.destinationKey),
          signal,
          onProviderSuccess: () => {
            providerSucceeded = true;
          },
        }),
      { isSuccessful: () => providerSucceeded },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof IntegrationError && error.kind === "QUOTA")
      return deferred(Math.max(60_000, error.retryAfterMs ?? 60_000));
    if (error instanceof IntegrationError && WAITABLE.has(error.kind)) {
      const retries = await recordArchiveRetry(archiveId, { code: error.code, message: error.message });
      if (retries > MAX_ARCHIVE_RETRIES) {
        return failArchive(archiveId, error.code, `${error.message} (đã thử lại ${MAX_ARCHIVE_RETRIES} lần)`);
      }
      return deferred(error.retryAfterMs ?? archiveBackoffMs(retries));
    }
    return failArchive(
      archiveId,
      error instanceof AppError ? error.code : "ARCHIVE_STEP_ERROR",
      toSafeErrorMessage(error),
    );
  }
  if (outcome.kind === "FAILED") throw new AppError(outcome.code, outcome.message, 422);
  return { archiveId, outcome: "COMPLETED" };
};
