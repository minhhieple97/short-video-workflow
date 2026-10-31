// What the UI may know about an archive. The upload session token, local paths, checksums and the account ID stay on the
// server; the Drive folder link appears only once every file was verified, the video's own link once that file was.
export interface ArchiveFileDto {
  kind: string;
  remoteName: string;
  status: string;
  bytes: number | null;
  // Bytes Google confirmed holding, from the last checkpoint.
  uploadedBytes: number;
  verifiedAt: string | null;
}

export interface ArchiveDto {
  id: string;
  provider: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  retries: number;
  createdAt: string;
  completedAt: string | null;
  // The render's folder on Drive, and the MP4 inside it.
  folderUrl: string | null;
  videoUrl: string | null;
  files: ArchiveFileDto[];
}

export interface RenderArchivesDto {
  renderId: string;
  archives: ArchiveDto[];
}

// Where a video stands on Drive, for screens that list videos or head one: the newest finished FINAL render is the one
// that is, or should be, there. A video without such a render has no entry at all.
export interface VideoDriveDto {
  renderId: string;
  // Its newest archive; null when it has none (Drive was not connected, or nobody asked yet).
  archive: ArchiveDto | null;
  // The script changed after this render, so the copy on Drive shows an older version.
  outdated: boolean;
}

// Every video of a book with where it stands on Drive, in the order the videos were made: the result of a batch.
export interface BookDriveLinksDto {
  bookId: string;
  videos: { id: string; title: string; drive?: VideoDriveDto }[];
}
