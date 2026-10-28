import { randomUUID } from "node:crypto";

import { createJobIntentWithin } from "@/features/jobs/repositories/job-dispatch.repository";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { ACTIVE_JOB_STATUSES } from "@/shared/types/job";
import type {
  ArchiveDestination,
  ArchiveFileKind,
  ArchiveUploadCheckpoint,
} from "@/server/archive/video-archive-provider";

import { UNFINISHED_ARCHIVE_STATUSES } from "../domain/archive-status";

export const ARCHIVE_ENTITY = "ARCHIVE";

const WITH_FILES = { files: { orderBy: { kind: "asc" } } } as const satisfies Prisma.RenderArchiveInclude;

export type RenderArchiveRecord = Prisma.RenderArchiveGetPayload<{ include: typeof WITH_FILES }>;

export interface ArchiveTarget {
  renderId: string;
  provider: string;
  destinationKey: string;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function findRenderForArchive(renderId: string) {
  return prisma.renderRecord.findUnique({ where: { id: renderId }, include: { video: { select: { bookId: true } } } });
}

export function findRenderArchive(id: string): Promise<RenderArchiveRecord | null> {
  return prisma.renderArchive.findUnique({ where: { id }, include: WITH_FILES });
}

export function findRenderArchiveFor(target: ArchiveTarget): Promise<RenderArchiveRecord | null> {
  return prisma.renderArchive.findUnique({
    where: { renderId_provider_destinationKey: target },
    include: WITH_FILES,
  });
}

// One archive per render and destination: asking again returns the archive that exists, with its files and remote IDs.
export async function ensureRenderArchive(
  target: ArchiveTarget,
  files: readonly { kind: ArchiveFileKind; remoteName: string }[],
): Promise<{ archive: RenderArchiveRecord; created: boolean }> {
  const existing = await findRenderArchiveFor(target);
  if (existing) return { archive: existing, created: false };
  try {
    const archive = await prisma.renderArchive.create({
      data: { ...target, files: { create: files.map((file) => ({ ...file })) } },
      include: WITH_FILES,
    });
    return { archive, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findRenderArchiveFor(target);
    if (!winner) throw error;
    return { archive: winner, created: false };
  }
}

// Remote IDs are written once. A second allocation (a replay, a race) never replaces them: the caller gets back the IDs
// that are stored and must use those, so every retry targets the objects the first attempt may already have created.
export async function saveRemoteIds(archiveId: string, destination: ArchiveDestination): Promise<ArchiveDestination> {
  return prisma.$transaction(async (tx) => {
    await tx.renderArchive.updateMany({
      where: { id: archiveId, remoteFolderId: null },
      data: { remoteFolderId: destination.folderId },
    });
    for (const [kind, remoteFileId] of Object.entries(destination.fileIds)) {
      await tx.renderArchiveFile.updateMany({ where: { archiveId, kind, remoteFileId: null }, data: { remoteFileId } });
    }
    const stored = await tx.renderArchive.findUniqueOrThrow({ where: { id: archiveId }, include: WITH_FILES });
    return storedDestination(stored) ?? destination;
  });
}

export function storedDestination(archive: RenderArchiveRecord): ArchiveDestination | null {
  const ids = new Map(archive.files.map((file) => [file.kind, file.remoteFileId]));
  const video = ids.get("VIDEO");
  const script = ids.get("SCRIPT");
  const manifest = ids.get("MANIFEST");
  if (!archive.remoteFolderId || !video || !script || !manifest) return null;
  return { folderId: archive.remoteFolderId, fileIds: { VIDEO: video, SCRIPT: script, MANIFEST: manifest } };
}

// The local file is fixed when it is handed to the archive; a file already being uploaded keeps what it started with.
export async function saveLocalFile(
  archiveId: string,
  kind: ArchiveFileKind,
  file: { localPath: string; bytes: number; sha256: string },
): Promise<boolean> {
  const { count } = await prisma.renderArchiveFile.updateMany({
    where: { archiveId, kind, status: "PENDING" },
    data: file,
  });
  return count > 0;
}

// A checkpoint only moves forward within one upload session; a new session (the old one expired) starts its own count.
export async function saveUploadCheckpoint(
  archiveId: string,
  kind: ArchiveFileKind,
  checkpoint: ArchiveUploadCheckpoint,
): Promise<boolean> {
  const { count } = await prisma.renderArchiveFile.updateMany({
    where: {
      archiveId,
      kind,
      status: { in: ["PENDING", "UPLOADING"] },
      OR: [
        { checkpointToken: null },
        { checkpointToken: { not: checkpoint.token } },
        { checkpointBytes: { lte: checkpoint.bytesSent } },
      ],
    },
    data: { status: "UPLOADING", checkpointToken: checkpoint.token, checkpointBytes: checkpoint.bytesSent },
  });
  return count > 0;
}

// The session token is dropped as soon as the upload is done: nothing needs it any more and it can grant upload access.
export async function markFileUploaded(archiveId: string, kind: ArchiveFileKind, bytes: number): Promise<boolean> {
  const { count } = await prisma.renderArchiveFile.updateMany({
    where: { archiveId, kind, status: { in: ["PENDING", "UPLOADING"] } },
    data: { status: "UPLOADED", checkpointToken: null, checkpointBytes: bytes },
  });
  return count > 0;
}

export async function markFileVerified(archiveId: string, kind: ArchiveFileKind, now = new Date()): Promise<boolean> {
  const { count } = await prisma.renderArchiveFile.updateMany({
    where: { archiveId, kind, status: "UPLOADED" },
    data: { status: "VERIFIED", verifiedAt: now },
  });
  return count > 0;
}

// The remote copy did not match: upload again into the same remote file, from the start.
export async function restartFileUpload(archiveId: string, kind: ArchiveFileKind): Promise<void> {
  await prisma.renderArchiveFile.updateMany({
    where: { archiveId, kind },
    data: { status: "PENDING", checkpointToken: null, checkpointBytes: 0, verifiedAt: null },
  });
}

export async function setArchiveStatus(
  archiveId: string,
  status: "RUNNING" | "WAITING" | "FAILED",
  failure?: { code: string; message: string },
): Promise<boolean> {
  const { count } = await prisma.renderArchive.updateMany({
    where: { id: archiveId, status: { in: [...UNFINISHED_ARCHIVE_STATUSES, "FAILED"] } },
    data: { status, errorCode: failure?.code ?? null, errorMessage: failure?.message ?? null },
  });
  return count > 0;
}

// Completes only when every file was verified against its local copy; the check and the write happen together.
export function completeArchive(archiveId: string, now = new Date()): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const unverified = await tx.renderArchiveFile.count({ where: { archiveId, status: { not: "VERIFIED" } } });
    if (unverified > 0) return false;
    const { count } = await tx.renderArchive.updateMany({
      where: { id: archiveId, status: { in: [...UNFINISHED_ARCHIVE_STATUSES] } },
      data: { status: "COMPLETED", completedAt: now, errorCode: null, errorMessage: null },
    });
    return count > 0;
  });
}

export function listUnfinishedArchiveIds(destination?: {
  provider: string;
  destinationKey: string;
}): Promise<string[]> {
  return prisma.renderArchive
    .findMany({
      where: { status: { in: [...UNFINISHED_ARCHIVE_STATUSES] }, ...destination },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    .then((archives) => archives.map((archive) => archive.id));
}

// A temporary failure parks the archive as WAITING with its reason and counts it; returns the new count.
export async function recordArchiveRetry(
  archiveId: string,
  failure: { code: string; message: string },
): Promise<number> {
  const archive = await prisma.renderArchive.update({
    where: { id: archiveId },
    data: { status: "WAITING", retries: { increment: 1 }, errorCode: failure.code, errorMessage: failure.message },
  });
  return archive.retries;
}

// Finished FINAL renders that asked to be archived (the intent is written with the render) and have no archive yet in
// this destination.
export async function listRendersAwaitingArchive(destination: { provider: string; destinationKey: string }) {
  return prisma.renderRecord.findMany({
    where: {
      status: "COMPLETED",
      qualityPreset: "FINAL",
      archiveIntentAt: { not: null },
      archives: { none: destination },
    },
    select: { id: true },
    orderBy: { completedAt: "asc" },
  });
}

function startArchiveJobWithin(tx: Prisma.TransactionClient, archiveId: string) {
  return createJobIntentWithin(tx, {
    bullmqJobId: randomUUID(),
    jobType: "ARCHIVE_RENDER",
    entityType: ARCHIVE_ENTITY,
    entityId: archiveId,
    payload: { archiveId },
  });
}

function findActiveArchiveJob(tx: Prisma.TransactionClient, archiveId: string) {
  return tx.jobRecord.findFirst({
    where: {
      jobType: "ARCHIVE_RENDER",
      entityType: ARCHIVE_ENTITY,
      entityId: archiveId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
  });
}

// Gives an unfinished archive a job when it has none. Writing the archive first takes SQLite's write lock, so two callers
// cannot both find no job and start one each.
export function ensureArchiveJob(archiveId: string): Promise<{ jobRecordId: string; started: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.renderArchive.updateMany({
      where: { id: archiveId, status: { in: [...UNFINISHED_ARCHIVE_STATUSES] } },
      data: { updatedAt: new Date() },
    });
    if (count === 0) return null;
    const active = await findActiveArchiveJob(tx, archiveId);
    if (active) return { jobRecordId: active.id, started: false };
    const intent = await startArchiveJobWithin(tx, archiveId);
    return { jobRecordId: intent.jobRecordId, started: true };
  });
}

// The archive and its job are written together, so an archive never waits for a job that was not recorded.
export async function createArchiveWithJob(
  target: ArchiveTarget,
  files: readonly { kind: ArchiveFileKind; remoteName: string }[],
): Promise<{ archiveId: string; created: boolean }> {
  try {
    const archiveId = await prisma.$transaction(async (tx) => {
      const archive = await tx.renderArchive.create({
        data: { ...target, files: { create: files.map((file) => ({ ...file })) } },
      });
      await startArchiveJobWithin(tx, archive.id);
      return archive.id;
    });
    return { archiveId, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await findRenderArchiveFor(target);
    if (!existing) throw error;
    await ensureArchiveJob(existing.id);
    return { archiveId: existing.id, created: false };
  }
}

// Cancelling an archive's job stops that archive; it waits for the user to retry it.
export async function cancelArchive(archiveId: string): Promise<void> {
  await prisma.renderArchive.updateMany({
    where: { id: archiveId, status: { in: [...UNFINISHED_ARCHIVE_STATUSES] } },
    data: { status: "FAILED", errorCode: "ARCHIVE_CANCELLED", errorMessage: "Đã huỷ việc lưu lên Google Drive." },
  });
}

export function listVideoArchives(videoId: string): Promise<RenderArchiveRecord[]> {
  return prisma.renderArchive.findMany({
    where: { render: { videoId } },
    include: WITH_FILES,
    orderBy: { createdAt: "desc" },
  });
}

export function listRenderArchives(renderId: string): Promise<RenderArchiveRecord[]> {
  return prisma.renderArchive.findMany({ where: { renderId }, include: WITH_FILES, orderBy: { createdAt: "desc" } });
}

export type ArchiveRetryMode =
  // Carry on from the stored checkpoints and remote IDs.
  | "RESUME"
  // A remote copy did not match; a Drive file ID cannot be created twice, so the unverified files get new IDs.
  | "NEW_FILE_IDS"
  // The render's folder is gone from Drive, and with it every file in it: start the archive's remote side again.
  | "NEW_DESTINATION";

// Puts a failed archive back in the queue, with its job, in one transaction. The status change is the first write, so
// two retries at once cannot both start a job.
export function resetArchiveForRetry(
  archiveId: string,
  mode: ArchiveRetryMode,
): Promise<{ jobRecordId: string } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.renderArchive.updateMany({
      where: { id: archiveId, status: "FAILED" },
      data: {
        status: "PENDING",
        retries: 0,
        errorCode: null,
        errorMessage: null,
        ...(mode === "NEW_DESTINATION" ? { remoteFolderId: null } : {}),
      },
    });
    if (count === 0) return null;
    const restart = {
      status: "PENDING",
      remoteFileId: null,
      checkpointToken: null,
      checkpointBytes: 0,
      verifiedAt: null,
    };
    if (mode === "NEW_DESTINATION") await tx.renderArchiveFile.updateMany({ where: { archiveId }, data: restart });
    if (mode === "NEW_FILE_IDS") {
      await tx.renderArchiveFile.updateMany({ where: { archiveId, status: { not: "VERIFIED" } }, data: restart });
    }
    const intent = await startArchiveJobWithin(tx, archiveId);
    return { jobRecordId: intent.jobRecordId };
  });
}

export function countFailedArchives(destination: { provider: string; destinationKey: string }): Promise<number> {
  return prisma.renderArchive.count({ where: { ...destination, status: "FAILED" } });
}
