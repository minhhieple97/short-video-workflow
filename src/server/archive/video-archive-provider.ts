import type { CallOptions } from "@/server/integrations/call-options";

export const ARCHIVE_FILE_KINDS = ["VIDEO", "SCRIPT", "MANIFEST"] as const;
export type ArchiveFileKind = (typeof ARCHIVE_FILE_KINDS)[number];

export interface ArchiveDestinationRequest {
  bookId: string;
  videoId: string;
  renderId: string;
}

// Remote IDs are allocated before any upload, so a retry after a lost response targets the same objects.
export interface ArchiveDestination {
  folderId: string;
  fileIds: Record<ArchiveFileKind, string>;
}

export interface ArchiveFileSource {
  kind: ArchiveFileKind;
  // Absolute path already resolved through storage/safe-path.
  localPath: string;
  remoteName: string;
  mimeType: string;
  bytes: number;
}

// token is opaque to callers and safe to persist; it never carries credentials.
export interface ArchiveUploadCheckpoint {
  token: string;
  bytesSent: number;
}

export interface ArchiveUploadRequest {
  destination: ArchiveDestination;
  file: ArchiveFileSource;
  checkpoint: ArchiveUploadCheckpoint | null;
}

export interface ArchiveUploadOptions extends CallOptions {
  onCheckpoint?: (checkpoint: ArchiveUploadCheckpoint) => void | Promise<void>;
}

export interface ArchiveUploadResult {
  // Bytes the remote side confirms it holds.
  bytes: number;
}

export interface ArchiveVerifyRequest {
  destination: ArchiveDestination;
  file: ArchiveFileSource;
}

export type ArchiveVerification =
  { status: "verified" } | { status: "missing" } | { status: "mismatch"; reason: string };

export interface VideoArchiveProvider {
  readonly id: string;
  prepareDestination(request: ArchiveDestinationRequest, options?: CallOptions): Promise<ArchiveDestination>;
  // Resolves only when the whole file is stored; replaying an upload for the same destination must not create a second object.
  upload(request: ArchiveUploadRequest, options?: ArchiveUploadOptions): Promise<ArchiveUploadResult>;
  // Compares the remote object with the local file (size and checksum) rather than trusting an earlier upload response.
  verify(request: ArchiveVerifyRequest, options?: CallOptions): Promise<ArchiveVerification>;
}
