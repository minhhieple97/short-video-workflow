import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type {
  ArchiveDestination,
  ArchiveFileKind,
  ArchiveUploadCheckpoint,
} from "@/server/archive/video-archive-provider";

import { UNFINISHED_ARCHIVE_STATUSES } from "../domain/archive-status";

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

export function listUnfinishedArchiveIds(): Promise<string[]> {
  return prisma.renderArchive
    .findMany({
      where: { status: { in: [...UNFINISHED_ARCHIVE_STATUSES] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    .then((archives) => archives.map((archive) => archive.id));
}
