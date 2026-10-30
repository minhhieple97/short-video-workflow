import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as VoiceJobs from "@/features/videos/services/voice-jobs.service";
import type * as DbClient from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let voice: typeof VoiceJobs;

let videoId: string;
let sceneIds: string[];
let jobCount = 0;

async function newVideo(): Promise<string> {
  const book = await db.prisma.book.findFirstOrThrow();
  return (await db.prisma.video.create({ data: { bookId: book.id, title: "Video", targetDurationSec: 60 } })).id;
}

async function newScene(forVideo: string, order: number): Promise<string> {
  const scene = await db.prisma.videoScene.create({
    data: {
      videoId: forVideo,
      order,
      type: "HOOK",
      narration: `Lời ${order}`,
      onScreenText: `Chữ ${order}`,
      visualVariant: "SCENARIO_CARD",
      contentHash: `hash-${forVideo}-${order}`,
    },
  });
  return scene.id;
}

// Each job is made one second after the one before, so "newest" is never a tie.
function voiceJob(
  sceneId: string,
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "CANCEL_REQUESTED",
  extra: { errorMessage?: string; jobType?: string; entityType?: string } = {},
) {
  jobCount += 1;
  return db.prisma.jobRecord.create({
    data: {
      bullmqJobId: `bull-${jobCount}`,
      jobType: extra.jobType ?? "GENERATE_SCENE_TTS",
      entityType: extra.entityType ?? "SCENE",
      entityId: sceneId,
      status,
      errorMessage: extra.errorMessage,
      createdAt: new Date(Date.UTC(2026, 9, 30, 8, 0, jobCount)),
    },
  });
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  voice = await import("@/features/videos/services/voice-jobs.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.jobRecord.deleteMany();
  await db.prisma.book.deleteMany();
  await db.prisma.book.create({
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
  videoId = await newVideo();
  sceneIds = [await newScene(videoId, 0), await newScene(videoId, 1), await newScene(videoId, 2)];
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getVoiceJobs", () => {
  it("is empty for a video without scenes or voice jobs", async () => {
    expect(await voice.getVoiceJobs(videoId)).toEqual({});
    expect(await voice.getVoiceJobs(await newVideo())).toEqual({});
  });

  it("shows a scene whose voice is queued or being made, so the page can stop asking for it again", async () => {
    const queued = await voiceJob(sceneIds[0] ?? "", "QUEUED");
    const running = await voiceJob(sceneIds[1] ?? "", "RUNNING");

    expect(await voice.getVoiceJobs(videoId)).toEqual({
      [sceneIds[0] ?? ""]: { jobId: queued.id, status: "QUEUED", errorMessage: null },
      [sceneIds[1] ?? ""]: { jobId: running.id, status: "RUNNING", errorMessage: null },
    });
  });

  it("keeps why the last attempt failed, until a newer one replaces it", async () => {
    const failed = await voiceJob(sceneIds[0] ?? "", "FAILED", { errorMessage: "edge-tts không trả về âm thanh." });

    expect((await voice.getVoiceJobs(videoId))[sceneIds[0] ?? ""]).toEqual({
      jobId: failed.id,
      status: "FAILED",
      errorMessage: "edge-tts không trả về âm thanh.",
    });

    const retry = await voiceJob(sceneIds[0] ?? "", "QUEUED");
    expect((await voice.getVoiceJobs(videoId))[sceneIds[0] ?? ""]).toEqual({
      jobId: retry.id,
      status: "QUEUED",
      errorMessage: null,
    });
  });

  it("says nothing of a scene whose newest job finished or was cancelled, even after an older failure", async () => {
    await voiceJob(sceneIds[0] ?? "", "FAILED", { errorMessage: "lỗi cũ" });
    await voiceJob(sceneIds[0] ?? "", "COMPLETED");
    await voiceJob(sceneIds[1] ?? "", "CANCELLED");

    expect(await voice.getVoiceJobs(videoId)).toEqual({});
  });

  it("ignores other kinds of job, other kinds of entity and the scenes of other videos", async () => {
    await voiceJob(sceneIds[0] ?? "", "QUEUED", { jobType: "GENERATE_VIDEO_SCRIPT" });
    await voiceJob(videoId, "QUEUED", { entityType: "VIDEO" });
    const otherVideo = await newVideo();
    await voiceJob(await newScene(otherVideo, 0), "QUEUED");

    expect(await voice.getVoiceJobs(videoId)).toEqual({});
  });
});
