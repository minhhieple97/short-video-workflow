import "server-only";

import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { archiveFolderUrl, archiveVideoUrl } from "../domain/archive-labels";
import {
  findRenderArchive,
  findRenderForArchive,
  listFinalRendersWithArchive,
  listRenderArchives,
  listVideoArchives,
  type RenderArchiveRecord,
} from "../repositories/render-archive.repository";
import type { ArchiveDto, RenderArchivesDto, VideoDriveDto } from "../schemas/archive.dto";
import { currentArchiveDestination, requestRenderArchive } from "./archive-request.service";
import { retryArchiveRecord } from "./archive-retry.service";

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
    folderUrl: archiveFolderUrl(archive.status, archive.remoteFolderId),
    videoUrl: archiveVideoUrl(archive.files.find((file) => file.kind === "VIDEO")),
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

// The newest archive of each render of the video, for the render history.
export async function getVideoArchives(videoId: string): Promise<Record<string, ArchiveDto>> {
  const latest: Record<string, ArchiveDto> = {};
  for (const archive of await listVideoArchives(videoId)) latest[archive.renderId] ??= toArchiveDto(archive);
  return latest;
}

// Where each of these videos stands on Drive, by video id. A video with no finished FINAL render is left out.
export async function getVideoDriveLinks(videoIds: readonly string[]): Promise<Record<string, VideoDriveDto>> {
  const links: Record<string, VideoDriveDto> = {};
  for (const render of await listFinalRendersWithArchive(videoIds)) {
    const [archive] = render.archives;
    links[render.videoId] = {
      renderId: render.id,
      archive: archive ? toArchiveDto(archive) : null,
      outdated: render.scriptVersion < render.video.scriptVersion,
    };
  }
  return links;
}

export async function getRenderArchives(renderId: string): Promise<RenderArchivesDto> {
  await requireRender(renderId);
  return { renderId, archives: (await listRenderArchives(renderId)).map(toArchiveDto) };
}

// Retries only what failed: the render is never made again, and verified files and remote IDs are reused, except that a
// removed render folder is rebuilt and a remote copy that did not match is uploaded as a new file (nothing is deleted
// in Drive). A retry that loses a race with another one does nothing.
async function retryArchive(archive: RenderArchiveRecord): Promise<void> {
  if (await retryArchiveRecord(archive)) logger.info("Archive retried", { archiveId: archive.id });
}

// Archives the render now, or carries on with its archive, in the connected account. A finished archive is returned as it
// is; a failed one is retried; one in progress keeps (or, through requestRenderArchive, gets back) its job.
export async function archiveRenderNow(renderId: string): Promise<ArchiveDto> {
  await requireRender(renderId);
  const destination = await currentArchiveDestination();
  if (!destination) {
    throw new AppError("DRIVE_NOT_CONNECTED", "Chưa kết nối Google Drive hoặc cần kết nối lại trong Cài đặt.", 409);
  }
  const outcome = await requestRenderArchive(renderId, destination, { userRequested: true });
  if (outcome.status !== "REQUESTED") {
    throw new AppError("ARCHIVE_NOT_ARCHIVABLE", "Chỉ lưu được bản render đã hoàn tất.", 409);
  }
  const archive = await findRenderArchive(outcome.archiveId);
  if (!archive) throw new NotFoundError("ARCHIVE_NOT_FOUND", "Không tìm thấy bản lưu trữ.");
  if (archive.status === "FAILED") await retryArchive(archive);

  const current = await findRenderArchive(archive.id);
  if (!current) throw new NotFoundError("ARCHIVE_NOT_FOUND", "Không tìm thấy bản lưu trữ.");
  return toArchiveDto(current);
}
