// What the UI may know about an archive. The upload session token, local paths, checksums and the account ID stay on the
// server; the Drive folder link appears only once every file was verified.
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
  folderUrl: string | null;
  files: ArchiveFileDto[];
}

export interface RenderArchivesDto {
  renderId: string;
  archives: ArchiveDto[];
}
