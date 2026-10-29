import { readStoredRenderSnapshot } from "@/features/videos/domain/render-snapshot";
import { type ArchiveFileKind, type VideoArchiveProvider } from "@/server/archive/video-archive-provider";
import { IntegrationError } from "@/server/integrations/integration-error";
import { NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import {
  completeArchive,
  findRenderArchive,
  findRenderForArchive,
  markFileUploaded,
  markFileVerified,
  restartFileUpload,
  saveLocalFile,
  saveRemoteIds,
  saveUploadCheckpoint,
  setArchiveStatus,
  storedDestination,
  type RenderArchiveRecord,
} from "../repositories/render-archive.repository";
import { materializeArchiveFiles, type ArchiveLocalFile } from "./archive-files.service";

const logger = createLogger("archive.run");

export type ArchiveRunOutcome = { kind: "COMPLETED" } | { kind: "FAILED"; code: string; message: string };

// The manifest describes the other files, so it goes last.
const UPLOAD_ORDER: readonly ArchiveFileKind[] = ["VIDEO", "SCRIPT", "PUBLISH", "MANIFEST"];

async function fail(archiveId: string, code: string, message: string): Promise<ArchiveRunOutcome> {
  await setArchiveStatus(archiveId, "FAILED", { code, message });
  logger.warn("Archive failed", { archiveId, code });
  return { kind: "FAILED", code, message };
}

// The files this archive was created with, in upload order. An archive created before publish.txt existed has no such
// entry and never gets one.
function entriesOf(archive: RenderArchiveRecord) {
  return UPLOAD_ORDER.flatMap((kind) =>
    archive.files.filter((file) => file.kind === kind).map((entry) => ({ kind, entry })),
  );
}

// Archives one finished render: its MP4 plus the script, the publish text and the manifest built from its snapshot. Each
// file is uploaded into the remote ID reserved for it, resumed from its checkpoint, and verified against the local copy;
// the archive completes only once all of them are verified. It never renders, voices or calls an AI again. A remote failure is thrown for the
// caller to wait and retry; what cannot be fixed by waiting fails the archive with its reason.
export async function runRenderArchive(input: {
  archiveId: string;
  provider: VideoArchiveProvider;
  signal?: AbortSignal;
}): Promise<ArchiveRunOutcome> {
  const { archiveId, provider, signal } = input;
  const archive = await findRenderArchive(archiveId);
  if (!archive) throw new NotFoundError("ARCHIVE_NOT_FOUND", "Không tìm thấy bản lưu trữ.");
  if (archive.status === "COMPLETED") return { kind: "COMPLETED" };

  const render = await findRenderForArchive(archive.renderId);
  if (!render || render.status !== "COMPLETED" || !render.completedAt) {
    return fail(archiveId, "ARCHIVE_RENDER_UNAVAILABLE", "Bản render chưa hoàn tất hoặc không còn, không thể lưu trữ.");
  }
  const snapshot = readStoredRenderSnapshot(render.snapshotJson, render.snapshotHash);
  if (!snapshot || !render.snapshotHash) {
    return fail(archiveId, "ARCHIVE_SNAPSHOT_MISSING", "Bản render không có snapshot hợp lệ để dựng hồ sơ lưu trữ.");
  }
  await setArchiveStatus(archiveId, "RUNNING");

  const files = await materializeArchiveFiles({
    snapshot,
    facts: {
      renderId: render.id,
      bookId: render.video.bookId,
      snapshotHash: render.snapshotHash,
      durationMs: render.durationMs,
      completedAt: render.completedAt.toISOString(),
    },
    videoOutputPath: render.outputPath,
  });
  const entries = entriesOf(archive);
  for (const { kind, entry } of entries) {
    const local = files[kind];
    if (!local) {
      return fail(archiveId, "ARCHIVE_LOCAL_FILE_MISSING", "Snapshot của bản render không có tệp cần lưu trữ.");
    }
    if (entry.status === "PENDING") {
      await saveLocalFile(archiveId, kind, {
        localPath: local.relativePath,
        bytes: local.source.bytes,
        sha256: local.sha256,
      });
    } else if (entry.sha256 !== local.sha256) {
      return fail(archiveId, "ARCHIVE_LOCAL_FILE_CHANGED", "Tệp local đã thay đổi sau khi bắt đầu upload.");
    }
  }

  const destination =
    storedDestination(archive) ??
    (await saveRemoteIds(
      archiveId,
      await provider.prepareDestination(
        { bookId: render.video.bookId, videoId: render.videoId, renderId: render.id },
        { signal },
      ),
    ));

  for (const { kind, entry } of entries) {
    const local = files[kind];
    if (!local) continue;
    const outcome = await archiveFile(archiveId, entry, local, destination, provider, signal);
    if (outcome) return outcome;
  }
  await completeArchive(archiveId);
  logger.info("Archive completed", { archiveId, renderId: render.id });
  return { kind: "COMPLETED" };
}

async function archiveFile(
  archiveId: string,
  entry: RenderArchiveRecord["files"][number],
  local: ArchiveLocalFile,
  destination: Parameters<VideoArchiveProvider["verify"]>[0]["destination"],
  provider: VideoArchiveProvider,
  signal: AbortSignal | undefined,
): Promise<ArchiveRunOutcome | null> {
  const kind = local.source.kind;
  if (entry.status === "VERIFIED") return null;
  if (entry.status !== "UPLOADED") {
    const checkpoint = entry.checkpointToken
      ? { token: entry.checkpointToken, bytesSent: entry.checkpointBytes }
      : null;
    const result = await provider.upload(
      { destination, file: local.source, checkpoint },
      {
        signal,
        onCheckpoint: async (next) => {
          await saveUploadCheckpoint(archiveId, kind, next);
        },
      },
    );
    if (result.bytes !== local.source.bytes) {
      return fail(
        archiveId,
        "ARCHIVE_REMOTE_MISMATCH",
        `Drive giữ ${result.bytes} byte cho ${local.source.remoteName}, tệp local có ${local.source.bytes} byte.`,
      );
    }
    await markFileUploaded(archiveId, kind, result.bytes);
  }

  const verification = await provider.verify({ destination, file: local.source }, { signal });
  if (verification.status === "verified") {
    await markFileVerified(archiveId, kind);
    return null;
  }
  if (verification.status === "missing") {
    await restartFileUpload(archiveId, kind);
    throw new IntegrationError(
      "ARCHIVE_REMOTE_MISSING",
      `Không thấy ${local.source.remoteName} trên Drive sau khi upload; sẽ upload lại.`,
      "TRANSIENT",
    );
  }
  return fail(archiveId, "ARCHIVE_REMOTE_MISMATCH", `${local.source.remoteName}: ${verification.reason}`);
}
