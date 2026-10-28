import "server-only";

import { archiveFolderChain } from "@/server/archive/google-drive/drive-folder-tree";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { archiveFolderStore } from "../repositories/archive-folder.repository";
import {
  findRenderArchive,
  findRenderForArchive,
  listRenderArchives,
  resetArchiveForRetry,
  type ArchiveRetryMode,
  type RenderArchiveRecord,
} from "../repositories/render-archive.repository";
import type { ArchiveDto, RenderArchivesDto } from "../schemas/archive.dto";
import { currentArchiveDestination, requestRenderArchive } from "./archive-request.service";

const logger = createLogger("archive.control");

export function toArchiveDto(archive: RenderArchiveRecord): ArchiveDto {
  return {
    id: archive.id,
    provider: archive.provider,
    status: archive.status,
    errorCode: archive.errorCode,
    errorMessage: archive.errorMessage,
    retries: archive.retries,
    createdAt: archive.createdAt.toISOString(),
    completedAt: archive.completedAt?.toISOString() ?? null,
    folderUrl:
      archive.status === "COMPLETED" && archive.remoteFolderId
        ? `https://drive.google.com/drive/folders/${encodeURIComponent(archive.remoteFolderId)}`
        : null,
    files: archive.files.map((file) => ({
      kind: file.kind,
      remoteName: file.remoteName,
      status: file.status,
      bytes: file.bytes,
      uploadedBytes: file.checkpointBytes,
      verifiedAt: file.verifiedAt?.toISOString() ?? null,
    })),
  };
}

async function requireRender(renderId: string) {
  const render = await findRenderForArchive(renderId);
  if (!render) throw new NotFoundError("RENDER_NOT_FOUND", "Không tìm thấy bản render.");
  return render;
}

export async function getRenderArchives(renderId: string): Promise<RenderArchivesDto> {
  await requireRender(renderId);
  return { renderId, archives: (await listRenderArchives(renderId)).map(toArchiveDto) };
}

function retryModeFor(errorCode: string | null): ArchiveRetryMode {
  if (errorCode === "ARCHIVE_FOLDER_MISSING") return "NEW_DESTINATION";
  if (errorCode === "ARCHIVE_REMOTE_MISMATCH") return "NEW_FILE_IDS";
  return "RESUME";
}

// Retries only what failed: the render is never made again, and verified files and remote IDs are reused, except that a
// removed render folder is rebuilt and a remote copy that did not match is uploaded as a new file (nothing is deleted
// in Drive). A retry that loses a race with another one does nothing.
async function retryArchive(archive: RenderArchiveRecord): Promise<void> {
  const mode = retryModeFor(archive.errorCode);
  if (mode === "NEW_DESTINATION") {
    const render = await requireRender(archive.renderId);
    const renderFolder = archiveFolderChain({
      bookId: render.video.bookId,
      videoId: render.videoId,
      renderId: render.id,
    }).at(-1);
    if (renderFolder) await archiveFolderStore(archive.provider, archive.destinationKey).forget(renderFolder.path);
  }
  if (await resetArchiveForRetry(archive.id, mode)) logger.info("Archive retried", { archiveId: archive.id, mode });
}

// Archives the render now, or carries on with its archive, in the connected account. A finished archive is returned as it
// is; a failed one is retried; one in progress keeps (or, through requestRenderArchive, gets back) its job.
export async function archiveRenderNow(renderId: string): Promise<ArchiveDto> {
  await requireRender(renderId);
  const destination = await currentArchiveDestination();
  if (!destination) {
    throw new AppError("DRIVE_NOT_CONNECTED", "Chưa kết nối Google Drive hoặc cần kết nối lại trong Cài đặt.", 409);
  }
  const outcome = await requestRenderArchive(renderId, destination);
  if (outcome.status !== "REQUESTED") {
    throw new AppError("ARCHIVE_NOT_ARCHIVABLE", "Chỉ lưu được bản render FINAL đã hoàn tất.", 409);
  }
  const archive = await findRenderArchive(outcome.archiveId);
  if (!archive) throw new NotFoundError("ARCHIVE_NOT_FOUND", "Không tìm thấy bản lưu trữ.");
  if (archive.status === "FAILED") await retryArchive(archive);

  const current = await findRenderArchive(archive.id);
  if (!current) throw new NotFoundError("ARCHIVE_NOT_FOUND", "Không tìm thấy bản lưu trữ.");
  return toArchiveDto(current);
}
