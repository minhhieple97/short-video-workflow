import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  currentSnapshotIdentity,
  fingerprintRenderSnapshot,
  type RenderSnapshot,
} from "@/features/videos/domain/render-snapshot";
import type { DriveCredential } from "@/server/archive/google-drive/drive-credential-store";
import type * as DbClient from "@/server/db/client";

export const CONNECTED_CREDENTIAL: DriveCredential = {
  status: "CONNECTED",
  refreshToken: "1//live",
  scope: "https://www.googleapis.com/auth/drive.file",
  accessToken: "ya29.stored",
  accessTokenExpiresAt: "2999-01-01T00:00:00.000Z",
  accountId: "permission-1",
  accountEmail: "ban@example.com",
  connectedAt: "2026-10-28T09:00:00.000Z",
};

export const TEST_DRIVE_CONFIG = {
  apiBaseUrl: undefined,
  clientId: "client-1.apps.googleusercontent.com",
  clientSecret: "secret",
  minRequestIntervalMs: 0,
  maxRequestsPerDay: 5000,
  maxUploadBytesPerDay: 10 * 1024 ** 3,
};

function snapshotFor(videoId: string): RenderSnapshot {
  return {
    ...currentSnapshotIdentity(),
    capturedAt: "2026-10-28T08:00:00.000Z",
    video: {
      id: videoId,
      title: "Video",
      bookTitle: "Sách",
      targetDurationSec: 60,
      scriptVersion: 2,
      status: "NEEDS_REVIEW",
      autoReady: true,
    },
    render: { quality: "FINAL", width: 1080, height: 1920, fps: 30 },
    scenes: [],
    audio: [],
    lessons: [],
  };
}

export async function seedArchiveVideo(db: typeof DbClient): Promise<string> {
  await db.prisma.book.deleteMany();
  const book = await db.prisma.book.create({
    data: {
      title: "Sách",
      sourceFilePath: "books/x/original.md",
      sourceFileName: "x.md",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "md",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  const video = await db.prisma.video.create({
    data: { bookId: book.id, title: "Video", targetDurationSec: 60, status: "DRAFT" },
  });
  return video.id;
}

// A finished render with a valid snapshot and a small MP4 on disk, asking (by default) to be archived.
export async function seedArchivableRender(
  db: typeof DbClient,
  dataDir: string,
  videoId: string,
  overrides: { qualityPreset?: "DRAFT" | "FINAL"; archiveIntentAt?: Date | null } = {},
): Promise<string> {
  const snapshot = snapshotFor(videoId);
  const render = await db.prisma.renderRecord.create({
    data: {
      videoId,
      scriptVersion: 2,
      outputPath: "pending",
      status: "COMPLETED",
      qualityPreset: overrides.qualityPreset ?? "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 5000,
      completedAt: new Date("2026-10-28T08:05:00.000Z"),
      archiveIntentAt:
        overrides.archiveIntentAt === undefined ? new Date("2026-10-28T08:05:00.000Z") : overrides.archiveIntentAt,
      snapshotJson: snapshot,
      snapshotHash: fingerprintRenderSnapshot(snapshot),
    },
  });
  const outputPath = `videos/${videoId}/renders/${render.id}-final.mp4`;
  await db.prisma.renderRecord.update({ where: { id: render.id }, data: { outputPath } });
  fs.mkdirSync(path.dirname(path.join(dataDir, outputPath)), { recursive: true });
  fs.writeFileSync(path.join(dataDir, outputPath), randomBytes(4000));
  return render.id;
}
