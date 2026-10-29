import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as FolderRepository from "@/features/archive/repositories/archive-folder.repository";
import type * as ArchiveRepository from "@/features/archive/repositories/render-archive.repository";
import type * as ArchiveRequest from "@/features/archive/services/archive-request.service";
import type * as ArchiveRun from "@/features/archive/services/archive-run.service";
import { formatPublishText } from "@/features/videos/domain/publish-metadata";
import {
  currentSnapshotIdentity,
  fingerprintRenderSnapshot,
  type RenderSnapshot,
} from "@/features/videos/domain/render-snapshot";
import { GoogleDriveArchiveProvider } from "@/server/archive/google-drive/drive-archive-provider";
import { UPLOAD_CHUNK_UNIT } from "@/server/archive/google-drive/drive-resumable-upload";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";
import type { VideoArchiveProvider } from "@/server/archive/video-archive-provider";
import type * as DbClient from "@/server/db/client";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ArchiveRepository;
let folders: typeof FolderRepository;
let run: typeof ArchiveRun;
let requests: typeof ArchiveRequest;
let google: FakeGoogleServer;

let videoId: string;
let renderId: string;
let bookId: string;
let archiveId: string;
let mp4: Buffer;

const SIZE = 2 * UPLOAD_CHUNK_UNIT + 777;

function snapshotFor(id: string): RenderSnapshot {
  return {
    ...currentSnapshotIdentity(),
    capturedAt: "2026-10-28T08:00:00.000Z",
    video: {
      id,
      title: "Hẹn ngày mai",
      bookTitle: "Sách thói quen",
      targetDurationSec: 60,
      scriptVersion: 4,
      status: "NEEDS_REVIEW",
      autoReady: true,
    },
    render: { quality: "FINAL", width: 1080, height: 1920, fps: 30 },
    scenes: [
      {
        id: "s2",
        order: 1,
        type: "SITUATION",
        title: null,
        narration: "Tối nào bạn cũng định tập.",
        onScreenText: "Tối nào cũng định",
        visualVariant: "SCENARIO_CARD",
        hookVariant: null,
        durationFrames: 150,
        hidden: false,
        audioAssetId: "a2",
      },
      {
        id: "s1",
        order: 0,
        type: "HOOK",
        title: "Hook",
        narration: "Vì sao bạn cứ hẹn ngày mai?",
        onScreenText: "Vì sao?",
        visualVariant: "HOOK_QUESTION",
        hookVariant: "QUESTION",
        durationFrames: 90,
        hidden: false,
        audioAssetId: "a1",
      },
      {
        id: "s3",
        order: 2,
        type: "ACTION_STEP",
        title: null,
        narration: "Cảnh ẩn.",
        onScreenText: "Ẩn",
        visualVariant: "SCENARIO_CARD",
        hookVariant: null,
        durationFrames: 60,
        hidden: true,
        audioAssetId: null,
      },
    ],
    audio: [
      {
        assetId: "a1",
        path: "videos/x/audio/a1.mp3",
        mimeType: "audio/mpeg",
        contentHash: "h1",
        durationMs: 2900,
        leadingSilenceMs: 0,
        provider: "edge-tts",
      },
      {
        assetId: "a2",
        path: "videos/x/audio/a2.mp3",
        mimeType: "audio/mpeg",
        contentHash: "h2",
        durationMs: 4900,
        leadingSilenceMs: 0,
        provider: "edge-tts",
      },
    ],
    lessons: [
      {
        lessonId: "l1",
        title: "Bắt đầu nhỏ",
        sources: [{ chapterId: "c1", chapterTitle: "Chương 1", excerpt: "Hãy bắt đầu nhỏ." }],
      },
    ],
  };
}

const provider = (): GoogleDriveArchiveProvider =>
  new GoogleDriveArchiveProvider({
    drive: new GoogleDriveClient({ getAccessToken: async () => "ya29.token", endpoints: google.endpoints }),
    folders: folders.archiveFolderStore("google-drive", "permission-1"),
    chunkBytes: UPLOAD_CHUNK_UNIT,
  });
const archive = () => db.prisma.renderArchive.findUniqueOrThrow({ where: { id: archiveId }, include: { files: true } });
const filesByName = () => new Map([...google.objects.values()].map((object) => [object.name, object]));
const uploadStarts = () =>
  google.requests.filter((entry) => entry.method === "POST" && entry.path === "/upload/drive/v3/files");
const readLocal = (relative: string) => fs.readFileSync(path.join(env.dataDir, relative), "utf8");

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/archive/repositories/render-archive.repository");
  folders = await import("@/features/archive/repositories/archive-folder.repository");
  run = await import("@/features/archive/services/archive-run.service");
  requests = await import("@/features/archive/services/archive-request.service");
}, 60_000);

beforeEach(async () => {
  google = new FakeGoogleServer();
  await google.start();
  await db.prisma.archiveFolder.deleteMany();
  await db.prisma.book.deleteMany();
  const book = await db.prisma.book.create({
    data: {
      title: "Sách thói quen",
      sourceFilePath: "books/x/original.md",
      sourceFileName: "x.md",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "md",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  bookId = book.id;
  const video = await db.prisma.video.create({
    data: { bookId, title: "Hẹn ngày mai", targetDurationSec: 60, status: "DRAFT", scriptVersion: 4 },
  });
  videoId = video.id;
  const snapshot = snapshotFor(videoId);
  const render = await db.prisma.renderRecord.create({
    data: {
      videoId,
      scriptVersion: 4,
      outputPath: "pending",
      status: "COMPLETED",
      qualityPreset: "FINAL",
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 8000,
      completedAt: new Date("2026-10-28T08:05:00.000Z"),
      snapshotJson: snapshot,
      snapshotHash: fingerprintRenderSnapshot(snapshot),
    },
  });
  renderId = render.id;
  const outputPath = `videos/${videoId}/renders/${renderId}-final.mp4`;
  await db.prisma.renderRecord.update({ where: { id: renderId }, data: { outputPath } });
  mp4 = randomBytes(SIZE);
  fs.mkdirSync(path.dirname(path.join(env.dataDir, outputPath)), { recursive: true });
  fs.writeFileSync(path.join(env.dataDir, outputPath), mp4);

  const { archive: created } = await repo.ensureRenderArchive(
    { renderId, provider: "google-drive", destinationKey: "permission-1" },
    [
      { kind: "VIDEO", remoteName: `video_s4_${renderId}_1080x1920.mp4` },
      { kind: "SCRIPT", remoteName: "script.json" },
      { kind: "MANIFEST", remoteName: "manifest.json" },
    ],
  );
  archiveId = created.id;
});

afterEach(async () => {
  await google.stop();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("runRenderArchive", () => {
  it("adds publish.txt, listed in the manifest, when the render carries a title, caption and hashtags", async () => {
    const publish = {
      title: "Vì sao bạn cứ hẹn ngày mai?",
      caption: "Vì sao bạn cứ hẹn ngày mai?\nSách: Sách thói quen\nLưu lại để thử tối nay!",
      hashtags: ["sachhay", "thoiquen", "booktok"],
    };
    const snapshot = { ...snapshotFor(videoId), publish };
    await db.prisma.renderArchive.deleteMany();
    await db.prisma.renderRecord.update({
      where: { id: renderId },
      data: { snapshotJson: snapshot, snapshotHash: fingerprintRenderSnapshot(snapshot), archiveIntentAt: new Date() },
    });

    const requested = await requests.requestRenderArchive(renderId, {
      provider: "google-drive",
      destinationKey: "permission-1",
    });
    if (requested.status !== "REQUESTED") throw new Error("The render is archivable.");
    archiveId = requested.archiveId;
    expect((await archive()).files.map((file) => file.kind).sort()).toEqual(["MANIFEST", "PUBLISH", "SCRIPT", "VIDEO"]);

    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toEqual({ kind: "COMPLETED" });

    expect(uploadStarts().map((start) => (JSON.parse(start.body) as { name: string }).name)).toEqual([
      `video_s4_${renderId}_1080x1920.mp4`,
      "script.json",
      "publish.txt",
      "manifest.json",
    ]);
    const text = formatPublishText(publish);
    expect(filesByName().get("publish.txt")?.content?.toString("utf8")).toBe(text);
    expect(readLocal(`videos/${videoId}/renders/${renderId}-publish.txt`)).toBe(text);
    const manifest = JSON.parse(readLocal(`videos/${videoId}/renders/${renderId}-manifest.json`)) as {
      files: Record<string, unknown>;
    };
    expect(manifest.files.publish).toEqual({
      name: "publish.txt",
      bytes: Buffer.byteLength(text),
      sha256: createHash("sha256").update(text).digest("hex"),
    });
  });

  it("archives only the three files of a render without a publish set", async () => {
    await run.runRenderArchive({ archiveId, provider: provider() });

    expect([...filesByName().keys()]).not.toContain("publish.txt");
    const manifest = JSON.parse(readLocal(`videos/${videoId}/renders/${renderId}-manifest.json`)) as {
      files: Record<string, unknown>;
    };
    expect(Object.keys(manifest.files).sort()).toEqual(["script", "video"]);
  });

  it("uploads the MP4, then the script, then the manifest into the render's folder and completes once all are verified", async () => {
    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toEqual({ kind: "COMPLETED" });

    const stored = await archive();
    expect(stored.status).toBe("COMPLETED");
    expect(stored.files.every((file) => file.status === "VERIFIED" && file.checkpointToken === null)).toBe(true);
    expect(uploadStarts().map((start) => (JSON.parse(start.body) as { name: string }).name)).toEqual([
      `video_s4_${renderId}_1080x1920.mp4`,
      "script.json",
      "manifest.json",
    ]);
    const remote = filesByName();
    expect(remote.get(`video_s4_${renderId}_1080x1920.mp4`)?.content?.equals(mp4)).toBe(true);
    const renderFolder = [...google.objects.values()].find((object) => object.name === renderId);
    expect(remote.get("script.json")?.parents).toEqual([renderFolder?.id]);
    expect(remote.get("manifest.json")?.parents).toEqual([renderFolder?.id]);
    expect(stored.remoteFolderId).toBe(renderFolder?.id);
  });

  it("writes the script from the render's snapshot, not from the video as it is now", async () => {
    await db.prisma.video.update({ where: { id: videoId }, data: { title: "Đã sửa sau render", scriptVersion: 9 } });

    await run.runRenderArchive({ archiveId, provider: provider() });

    const script = JSON.parse(filesByName().get("script.json")?.content?.toString("utf8") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(script).toMatchObject({
      schemaVersion: "archive-script-v1",
      title: "Hẹn ngày mai",
      scriptVersion: 4,
      renderId,
    });
    expect((script.scenes as { narration: string }[]).map((scene) => scene.narration)).toEqual([
      "Vì sao bạn cứ hẹn ngày mai?",
      "Tối nào bạn cũng định tập.",
    ]);
    expect(script.lessons).toEqual([
      { lessonId: "l1", title: "Bắt đầu nhỏ", sources: [{ chapterTitle: "Chương 1", excerpt: "Hãy bắt đầu nhỏ." }] },
    ]);
    expect(readLocal(`videos/${videoId}/renders/${renderId}-script.json`)).toBe(
      filesByName().get("script.json")?.content?.toString("utf8"),
    );
  });

  it("records in the manifest exactly the bytes that were uploaded, and no local path", async () => {
    await run.runRenderArchive({ archiveId, provider: provider() });

    const remote = filesByName();
    const manifestText = remote.get("manifest.json")?.content?.toString("utf8") ?? "";
    const manifest = JSON.parse(manifestText) as {
      files: { video: { sha256: string; bytes: number }; script: { sha256: string; bytes: number } };
    } & Record<string, unknown>;
    const sha = (data: Buffer | undefined) =>
      createHash("sha256")
        .update(data ?? Buffer.alloc(0))
        .digest("hex");
    expect(manifest).toMatchObject({
      schemaVersion: "archive-manifest-v1",
      renderId,
      videoId,
      bookId,
      quality: "FINAL",
      durationMs: 8000,
      renderCompletedAt: "2026-10-28T08:05:00.000Z",
      snapshotHash: (await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: renderId } })).snapshotHash,
    });
    expect(manifest.files.video).toEqual({ name: `video_s4_${renderId}_1080x1920.mp4`, bytes: SIZE, sha256: sha(mp4) });
    expect(manifest.files.script.sha256).toBe(sha(remote.get("script.json")?.content));
    expect(manifestText).not.toContain(env.dataDir);
    expect(manifestText.endsWith("}\n")).toBe(true);
  });

  it("rebuilds the record files with the same bytes on every run", async () => {
    await run.runRenderArchive({ archiveId, provider: provider() });
    const first = readLocal(`videos/${videoId}/renders/${renderId}-manifest.json`);
    const { materializeArchiveFiles } = await import("@/features/archive/services/archive-files.service");
    const render = await db.prisma.renderRecord.findUniqueOrThrow({ where: { id: renderId } });

    const again = await materializeArchiveFiles({
      snapshot: snapshotFor(videoId),
      facts: {
        renderId,
        bookId,
        snapshotHash: render.snapshotHash ?? "",
        durationMs: 8000,
        completedAt: "2026-10-28T08:05:00.000Z",
      },
      videoOutputPath: render.outputPath,
    });

    expect(readLocal(`videos/${videoId}/renders/${renderId}-manifest.json`)).toBe(first);
    expect(again.MANIFEST?.sha256).toBe((await archive()).files.find((file) => file.kind === "MANIFEST")?.sha256);
  });

  it("resumes an interrupted run from where each file stood, without a second copy of anything", async () => {
    const controller = new AbortController();
    const interrupting: VideoArchiveProvider = {
      id: "google-drive",
      prepareDestination: (request, options) => provider().prepareDestination(request, options),
      upload: (request, options) =>
        provider().upload(request, {
          ...options,
          onCheckpoint: async (checkpoint) => {
            await options?.onCheckpoint?.(checkpoint);
            if (checkpoint.bytesSent === UPLOAD_CHUNK_UNIT) controller.abort();
          },
        }),
      verify: (request, options) => provider().verify(request, options),
    };

    await expect(
      run.runRenderArchive({ archiveId, provider: interrupting, signal: controller.signal }),
    ).rejects.toThrow();
    const midway = (await archive()).files.find((file) => file.kind === "VIDEO");
    expect(midway).toMatchObject({ status: "UPLOADING", checkpointBytes: UPLOAD_CHUNK_UNIT });

    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toEqual({ kind: "COMPLETED" });
    expect(uploadStarts()).toHaveLength(3);
    expect(google.requestsTo("/drive/v3/files/generateIds")).toHaveLength(1);
    expect(
      [...google.objects.values()].filter((object) => object.mimeType !== "application/vnd.google-apps.folder"),
    ).toHaveLength(3);
  });

  it("does nothing more for an archive that is complete, even once the local MP4 is gone", async () => {
    await run.runRenderArchive({ archiveId, provider: provider() });
    const requests = google.requests.length;
    fs.rmSync(path.join(env.dataDir, `videos/${videoId}/renders/${renderId}-final.mp4`));

    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toEqual({ kind: "COMPLETED" });
    expect(google.requests).toHaveLength(requests);
  });

  it("refuses a render without a trustworthy snapshot, before touching Drive", async () => {
    await db.prisma.renderRecord.update({ where: { id: renderId }, data: { snapshotHash: "tampered" } });

    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toMatchObject({
      kind: "FAILED",
      code: "ARCHIVE_SNAPSHOT_MISSING",
    });
    expect((await archive()).status).toBe("FAILED");
    expect(google.requests).toHaveLength(0);
  });

  it("refuses a render that is not complete", async () => {
    await db.prisma.renderRecord.update({ where: { id: renderId }, data: { status: "FAILED" } });

    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toMatchObject({
      code: "ARCHIVE_RENDER_UNAVAILABLE",
    });
    expect(google.requests).toHaveLength(0);
  });

  it("fails when the MP4 changed after its upload began", async () => {
    await db.prisma.renderArchiveFile.updateMany({
      where: { archiveId, kind: "VIDEO" },
      data: { status: "UPLOADING", sha256: "an-earlier-file", checkpointToken: "t", checkpointBytes: 1 },
    });

    expect(await run.runRenderArchive({ archiveId, provider: provider() })).toMatchObject({
      code: "ARCHIVE_LOCAL_FILE_CHANGED",
    });
    expect(google.requests).toHaveLength(0);
  });

  it("fails with the reason when Drive's copy does not match, and stays incomplete", async () => {
    const real = provider();
    const lying: VideoArchiveProvider = {
      id: "google-drive",
      prepareDestination: (request, options) => real.prepareDestination(request, options),
      upload: (request, options) => real.upload(request, options),
      verify: async (request, options) =>
        request.file.kind === "MANIFEST"
          ? { status: "mismatch", reason: "SHA-256 khác." }
          : real.verify(request, options),
    };

    expect(await run.runRenderArchive({ archiveId, provider: lying })).toEqual({
      kind: "FAILED",
      code: "ARCHIVE_REMOTE_MISMATCH",
      message: "manifest.json: SHA-256 khác.",
    });
    const stored = await archive();
    expect(stored.status).toBe("FAILED");
    expect(stored.files.find((file) => file.kind === "MANIFEST")?.status).toBe("UPLOADED");
    expect(stored.files.find((file) => file.kind === "VIDEO")?.status).toBe("VERIFIED");
  });

  it("fails when Drive reports holding a different number of bytes than were sent", async () => {
    const real = provider();
    const short: VideoArchiveProvider = {
      id: "google-drive",
      prepareDestination: (request, options) => real.prepareDestination(request, options),
      upload: async (request, options) => ({ bytes: (await real.upload(request, options)).bytes - 1 }),
      verify: (request, options) => real.verify(request, options),
    };

    expect(await run.runRenderArchive({ archiveId, provider: short })).toMatchObject({
      kind: "FAILED",
      code: "ARCHIVE_REMOTE_MISMATCH",
    });
    expect((await archive()).files.find((file) => file.kind === "VIDEO")?.status).toBe("UPLOADING");
  });

  it("uploads again a file Drive lost right after the upload", async () => {
    const real = provider();
    let lost = false;
    const forgetful: VideoArchiveProvider = {
      id: "google-drive",
      prepareDestination: (request, options) => real.prepareDestination(request, options),
      upload: (request, options) => real.upload(request, options),
      verify: async (request, options) => {
        if (request.file.kind === "SCRIPT" && !lost) {
          lost = true;
          return { status: "missing" };
        }
        return real.verify(request, options);
      },
    };

    await expect(run.runRenderArchive({ archiveId, provider: forgetful })).rejects.toMatchObject({
      code: "ARCHIVE_REMOTE_MISSING",
      kind: "TRANSIENT",
    });
    expect((await archive()).files.find((file) => file.kind === "SCRIPT")).toMatchObject({
      status: "PENDING",
      checkpointToken: null,
    });
    expect(await run.runRenderArchive({ archiveId, provider: forgetful })).toEqual({ kind: "COMPLETED" });
    const startsFor = (name: string) =>
      uploadStarts().filter((start) => (JSON.parse(start.body) as { name: string }).name === name);
    expect(startsFor(`video_s4_${renderId}_1080x1920.mp4`)).toHaveLength(1);
    expect(startsFor("script.json")).toHaveLength(2);
  });
});
