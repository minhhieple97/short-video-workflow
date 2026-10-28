import type { Prisma, RenderRecord } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export const ACTIVE_RENDER_STATUSES = ["QUEUED", "RENDERING"] as const;

export function createRenderRecord(data: {
  id: string;
  videoId: string;
  scriptVersion: number;
  outputPath: string;
  qualityPreset: "DRAFT" | "FINAL";
  width: number;
  height: number;
  fps: number;
  snapshotJson?: Prisma.InputJsonObject;
  snapshotHash?: string;
}): Promise<RenderRecord> {
  return prisma.renderRecord.create({ data: { ...data, status: "QUEUED" } });
}

// Only for a render queued before snapshots existed: a snapshot, once stored, is never replaced.
export async function saveRenderSnapshotIfMissing(
  id: string,
  snapshot: Prisma.InputJsonObject,
  snapshotHash: string,
): Promise<void> {
  await prisma.renderRecord.updateMany({
    where: { id, snapshotHash: null },
    data: { snapshotJson: snapshot, snapshotHash },
  });
}

export function attachRenderJob(id: string, jobRecordId: string): Promise<RenderRecord> {
  return prisma.renderRecord.update({ where: { id }, data: { jobRecordId } });
}

export function findRenderRecord(id: string): Promise<RenderRecord | null> {
  return prisma.renderRecord.findUnique({ where: { id } });
}

export function listRenderRecords(videoId: string): Promise<RenderRecord[]> {
  return prisma.renderRecord.findMany({ where: { videoId }, orderBy: { createdAt: "desc" } });
}

export function findActiveRender(videoId: string, qualityPreset: "DRAFT" | "FINAL"): Promise<RenderRecord | null> {
  return prisma.renderRecord.findFirst({
    where: { videoId, qualityPreset, status: { in: [...ACTIVE_RENDER_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}

export function markRenderStarted(id: string, scriptVersion: number): Promise<RenderRecord> {
  return prisma.renderRecord.update({
    where: { id },
    data: { status: "RENDERING", scriptVersion, errorMessage: null },
  });
}

export function completeRenderRecord(
  render: Pick<RenderRecord, "id" | "videoId" | "outputPath">,
  result: { durationMs: number; sizeBytes: number },
): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.renderRecord.update({
      where: { id: render.id },
      data: { status: "COMPLETED", durationMs: result.durationMs, completedAt: new Date() },
    });
    await tx.mediaAsset.create({
      data: {
        videoId: render.videoId,
        kind: "RENDER",
        path: render.outputPath,
        mimeType: "video/mp4",
        durationMs: result.durationMs,
        fileSizeBytes: result.sizeBytes,
        provider: "remotion",
        generationSettingsJson: { renderRecordId: render.id },
      },
    });
    await tx.video.update({ where: { id: render.videoId }, data: { latestRenderId: render.id } });
  });
}

export function failRenderRecord(
  id: string,
  status: "FAILED" | "CANCELLED",
  errorMessage: string,
): Promise<RenderRecord> {
  return prisma.renderRecord.update({ where: { id }, data: { status, errorMessage, completedAt: new Date() } });
}

export function findRenderSizes(videoId: string): Promise<{ path: string; fileSizeBytes: number }[]> {
  return prisma.mediaAsset.findMany({
    where: { videoId, kind: "RENDER" },
    select: { path: true, fileSizeBytes: true },
  });
}
