import fs from "node:fs/promises";

import { IntegrationError } from "@/server/integrations/integration-error";

import type { ArchiveUploadOptions, ArchiveUploadRequest, ArchiveUploadResult } from "../video-archive-provider";
import { googleStatusOf, type DriveUploadState, type GoogleDriveClient } from "./google-drive-client";

// Google requires every chunk but the last to be a multiple of 256 KiB.
export const UPLOAD_CHUNK_UNIT = 256 * 1024;
export const DEFAULT_UPLOAD_CHUNK_BYTES = 32 * UPLOAD_CHUNK_UNIT;
const MAX_STALLED_CHUNKS = 3;
// A chunk whose answer was lost or timed out is followed by a status query, a few times in a row at most.
const MAX_CHUNK_RECOVERIES = 3;

// Thrown instead of sending forever; the next attempt asks Google where the upload stands and carries on from there.
const notAdvancing = () =>
  new IntegrationError(
    "DRIVE_UPLOAD_STALLED",
    "Google Drive không nhận thêm dữ liệu upload; sẽ thử lại sau.",
    "TRANSIENT",
  );

const sessionExpired = () =>
  new IntegrationError(
    "DRIVE_UPLOAD_SESSION_EXPIRED",
    "Phiên upload lên Google Drive đã hết hạn; sẽ bắt đầu lại vào cùng tệp.",
    "TRANSIENT",
  );

// Uploads one local file into the remote file ID reserved for it, in chunks read from disk into a single reused buffer,
// so memory stays at one chunk whatever the file size. Progress is reported only as the bytes Google confirms holding,
// and the session URI travels in the checkpoint, so a later call resumes where Google stands instead of starting over.
export class DriveResumableUpload {
  private readonly chunkBytes: number;

  constructor(
    private readonly drive: GoogleDriveClient,
    options: { chunkBytes?: number } = {},
  ) {
    this.chunkBytes = options.chunkBytes ?? DEFAULT_UPLOAD_CHUNK_BYTES;
    if (this.chunkBytes <= 0 || this.chunkBytes % UPLOAD_CHUNK_UNIT !== 0) {
      throw new RangeError("The upload chunk size must be a positive multiple of 256 KiB.");
    }
  }

  async upload(request: ArchiveUploadRequest, options: ArchiveUploadOptions = {}): Promise<ArchiveUploadResult> {
    const { file } = request;
    const { signal } = options;
    await this.assertLocalSize(file.localPath, file.bytes);

    let session = request.checkpoint?.token ?? null;
    let state: DriveUploadState = session
      ? await this.drive.queryUpload(session, file.bytes, signal)
      : { kind: "expired" };
    if (state.kind === "expired") {
      const started = await this.start(request, signal);
      if (started.kind === "complete") return { bytes: started.size };
      session = started.session;
      state = { kind: "incomplete", receivedBytes: 0 };
      await options.onCheckpoint?.({ token: session, bytesSent: 0 });
    }
    if (state.kind === "complete") return { bytes: state.size };
    if (!session) throw new Error("An incomplete upload always has a session.");

    const final = await this.sendChunks(session, request, state.receivedBytes, options);
    if (final.kind === "expired") throw sessionExpired();
    return { bytes: final.size };
  }

  private async sendChunks(
    session: string,
    request: ArchiveUploadRequest,
    from: number,
    options: ArchiveUploadOptions,
  ): Promise<Exclude<DriveUploadState, { kind: "incomplete" }>> {
    const { file } = request;
    const handle = await fs.open(file.localPath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(this.chunkBytes, file.bytes));
      let start = from;
      let stalled = 0;
      let recoveries = 0;
      for (;;) {
        if (start >= file.bytes || stalled >= MAX_STALLED_CHUNKS) throw notAdvancing();
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.byteLength, file.bytes - start), start);
        const chunk = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
        const state = await this.sendChunk(session, { start, chunk, total: file.bytes }, options.signal, recoveries);
        recoveries = state.recovered ? recoveries + 1 : 0;
        if (state.kind !== "incomplete") return state;
        // Google may keep less than was sent; the next chunk starts where Google says it stands.
        stalled = state.receivedBytes > start ? 0 : stalled + 1;
        start = state.receivedBytes;
        await options.onCheckpoint?.({ token: session, bytesSent: start });
      }
    } finally {
      await handle.close();
    }
  }

  // Google may have stored the chunk even though its answer never arrived ("don't assume the server received all bytes",
  // nor that it received none), so after a timeout or a dropped connection it is asked where the upload stands.
  private async sendChunk(
    session: string,
    input: { start: number; chunk: Uint8Array<ArrayBuffer>; total: number },
    signal: AbortSignal | undefined,
    recoveries: number,
  ): Promise<DriveUploadState & { recovered: boolean }> {
    try {
      return { ...(await this.drive.uploadChunk(session, input, signal)), recovered: false };
    } catch (error) {
      // A chunk is a write, so a timeout, a dropped connection or a 5xx all surface as UNKNOWN_OUTCOME.
      const recoverable = error instanceof IntegrationError && error.kind === "UNKNOWN_OUTCOME";
      if (!recoverable || signal?.aborted || recoveries >= MAX_CHUNK_RECOVERIES) throw error;
      return { ...(await this.drive.queryUpload(session, input.total, signal)), recovered: true };
    }
  }

  private async start(
    request: ArchiveUploadRequest,
    signal: AbortSignal | undefined,
  ): Promise<{ kind: "session"; session: string } | { kind: "complete"; size: number }> {
    const { file, destination } = request;
    const fileId = destination.fileIds[file.kind];
    try {
      const session = await this.drive.startResumableUpload(
        {
          id: fileId,
          name: file.remoteName,
          parentId: destination.folderId,
          mimeType: file.mimeType,
          bytes: file.bytes,
        },
        signal,
      );
      return { kind: "session", session };
    } catch (error) {
      const status = googleStatusOf(error);
      // The render's folder was removed in Drive after it was prepared; the file cannot go there.
      if (status === 404) {
        throw new IntegrationError(
          "ARCHIVE_FOLDER_MISSING",
          "Thư mục lưu bản render trên Google Drive không còn; cần chuẩn bị lại thư mục rồi upload.",
          "REJECTED",
          { cause: error },
        );
      }
      // An earlier attempt already finished this file (its answer was lost): Drive refuses the same ID a second time.
      if (status !== 409) throw error;
      return { kind: "complete", size: await this.drive.getFileSize(fileId, signal) };
    }
  }

  private async assertLocalSize(localPath: string, bytes: number): Promise<void> {
    const { size } = await fs.stat(localPath);
    if (bytes <= 0 || size !== bytes) {
      throw new IntegrationError(
        "ARCHIVE_LOCAL_FILE_CHANGED",
        "Tệp local không còn đúng kích thước đã ghi khi bắt đầu lưu trữ.",
        "REJECTED",
        { details: { expected: bytes, actual: size } },
      );
    }
  }
}
