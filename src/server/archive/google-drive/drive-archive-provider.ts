import { hashFile } from "@/server/storage/file-hash";
import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError } from "@/server/integrations/integration-error";

import type {
  ArchiveDestination,
  ArchiveDestinationRequest,
  ArchiveUploadOptions,
  ArchiveUploadRequest,
  ArchiveUploadResult,
  ArchiveVerification,
  ArchiveVerifyRequest,
  VideoArchiveProvider,
} from "../video-archive-provider";
import { DriveFolderTree, type ArchiveFolderStore } from "./drive-folder-tree";
import { DriveResumableUpload } from "./drive-resumable-upload";
import type { GoogleDriveClient } from "./google-drive-client";

export const GOOGLE_DRIVE_PROVIDER_ID = "google-drive";

export interface GoogleDriveArchiveProviderOptions {
  drive: GoogleDriveClient;
  folders: ArchiveFolderStore;
  chunkBytes?: number;
}

// Archives a render into the connected user's Google Drive. Nothing here deletes or searches the user's files: folders
// and files are only ever addressed by the IDs this app reserved for them.
export class GoogleDriveArchiveProvider implements VideoArchiveProvider {
  readonly id = GOOGLE_DRIVE_PROVIDER_ID;
  private readonly drive: GoogleDriveClient;
  private readonly tree: DriveFolderTree;
  private readonly uploader: DriveResumableUpload;

  constructor(options: GoogleDriveArchiveProviderOptions) {
    this.drive = options.drive;
    this.tree = new DriveFolderTree(options.drive, options.folders);
    this.uploader = new DriveResumableUpload(options.drive, { chunkBytes: options.chunkBytes });
  }

  prepareDestination(request: ArchiveDestinationRequest, options?: CallOptions): Promise<ArchiveDestination> {
    return this.tree.prepare(request, options?.signal);
  }

  upload(request: ArchiveUploadRequest, options?: ArchiveUploadOptions): Promise<ArchiveUploadResult> {
    return this.uploader.upload(request, options);
  }

  // Compares what Drive holds with the local file now, rather than trusting an earlier upload answer. The checksum
  // encoding is not stated in Drive's reference; hex (as Drive returns for md5Checksum) is compared case-insensitively.
  async verify(request: ArchiveVerifyRequest, options?: CallOptions): Promise<ArchiveVerification> {
    const remote = await this.drive.getFileMetadata(request.destination.fileIds[request.file.kind], options?.signal);
    if (!remote) return { status: "missing" };
    if (remote.trashed) return { status: "mismatch", reason: "Tệp trên Drive đã bị chuyển vào thùng rác." };

    const local = await hashFile(request.file.localPath, options?.signal);
    if (remote.size !== local.bytes) {
      return {
        status: "mismatch",
        reason: `Kích thước khác nhau: Drive ${remote.size ?? "?"} byte, local ${local.bytes} byte.`,
      };
    }
    if (remote.sha256Checksum) {
      return sameHex(remote.sha256Checksum, local.sha256)
        ? { status: "verified" }
        : { status: "mismatch", reason: "SHA-256 trên Drive khác với tệp local." };
    }
    if (remote.md5Checksum) {
      return sameHex(remote.md5Checksum, local.md5)
        ? { status: "verified" }
        : { status: "mismatch", reason: "MD5 trên Drive khác với tệp local." };
    }
    // Size alone is not proof; Drive fills checksums in for binary files, so ask again later.
    throw new IntegrationError(
      "DRIVE_CHECKSUM_PENDING",
      "Google Drive chưa có checksum cho tệp vừa upload; sẽ kiểm tra lại sau.",
      "TRANSIENT",
    );
  }
}

const sameHex = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
