import { archiveFolderChain } from "@/server/archive/google-drive/drive-folder-tree";

import { archiveFolderStore } from "../repositories/archive-folder.repository";
import {
  findRenderForArchive,
  resetArchiveForRetry,
  type RenderArchiveRecord,
} from "../repositories/render-archive.repository";

export async function retryArchiveRecord(archive: RenderArchiveRecord): Promise<boolean> {
  const mode =
    archive.errorCode === "ARCHIVE_FOLDER_MISSING"
      ? "NEW_DESTINATION"
      : archive.errorCode === "ARCHIVE_REMOTE_MISMATCH"
        ? "NEW_FILE_IDS"
        : "RESUME";
  if (mode === "NEW_DESTINATION") {
    const render = await findRenderForArchive(archive.renderId);
    if (!render) return false;
    const folder = archiveFolderChain({ bookId: render.video.bookId, videoId: render.videoId, renderId: render.id }).at(
      -1,
    );
    if (folder) await archiveFolderStore(archive.provider, archive.destinationKey).forget(folder.path);
  }
  return (await resetArchiveForRetry(archive.id, mode)) !== null;
}
