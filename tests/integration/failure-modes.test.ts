import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AnalysisRequest from "@/features/chapters/services/analysis-request.service";
import type * as ChapterAnalysis from "@/features/chapters/services/chapter-analysis.service";
import type * as JobControl from "@/features/jobs/services/job-control.service";
import type * as AudioService from "@/features/videos/services/audio.service";
import type * as RenderService from "@/features/videos/services/render.service";
import type * as TtsRunner from "@/features/videos/services/tts-runner";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as ScriptGeneration from "@/features/videos/services/script-generation.service";
import type * as DbClient from "@/server/db/client";
import { LocalCliTaskProvider } from "@/server/ai/local-cli-task-provider";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let analysisRequest: typeof AnalysisRequest;
let analysis: typeof ChapterAnalysis;
let jobControl: typeof JobControl;
let audio: typeof AudioService;
let tts: typeof TtsRunner;
let videos: typeof VideoService;
let generation: typeof ScriptGeneration;
let renders: typeof RenderService;
let chapterIds: string[];
let bookId: string;

function makeWav(file: string, seconds: number): Uint8Array {
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${seconds}`,
    "-ar",
    "24000",
    "-ac",
    "1",
    file,
  ]);
  return new Uint8Array(fs.readFileSync(file));
}

beforeAll(async () => {
  env = setupTestEnvironment();
  // Nothing listens here: every enqueue must fail fast instead of hanging.
  process.env.REDIS_URL = "redis://127.0.0.1:6399";
  process.env.EDGE_TTS_COMMAND = "/nonexistent/edge-tts";
  process.env.TTS_MODE = "edge-tts";

  db = await import("@/server/db/client");
  analysisRequest = await import("@/features/chapters/services/analysis-request.service");
  analysis = await import("@/features/chapters/services/chapter-analysis.service");
  jobControl = await import("@/features/jobs/services/job-control.service");
  audio = await import("@/features/videos/services/audio.service");
  tts = await import("@/features/videos/services/tts-runner");
  videos = await import("@/features/videos/services/video.service");
  generation = await import("@/features/videos/services/script-generation.service");
  renders = await import("@/features/videos/services/render.service");
  const importService = await import("@/features/books/services/book-import.service");
  const chapters = await import("@/features/chapters/services/chapter.service");

  const preview = await importService.previewImport({
    kind: "file",
    fileName: "sample.md",
    mimeType: "text/markdown",
    bytes: new Uint8Array(fs.readFileSync(SAMPLE_BOOK_PATH)),
  });
  ({ bookId } = await importService.confirmImport({
    importId: preview.importId,
    title: "Sách mẫu",
    author: null,
    description: null,
    allowDuplicate: false,
    chapters: preview.sections.filter((s) => s.include).map(({ title, start, end }) => ({ title, start, end })),
  }));
  chapterIds = (await chapters.listChapters(bookId)).map((chapter) => chapter.id);
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("Redis unavailable", () => {
  it("rejects an enqueue quickly with QUEUE_UNAVAILABLE and records the failed job", async () => {
    const startedAt = Date.now();
    await expect(analysisRequest.requestChapterAnalysis(chapterIds[0]!, false)).rejects.toMatchObject({
      code: "QUEUE_UNAVAILABLE",
      httpStatus: 503,
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    const record = await db.prisma.jobRecord.findFirstOrThrow({ where: { entityId: chapterIds[0] } });
    expect(record).toMatchObject({ status: "FAILED", errorCode: "QUEUE_UNAVAILABLE" });
    expect(await db.prisma.jobDispatch.count({ where: { jobRecordId: record.id } })).toBe(0);
  });
});

describe("Claude CLI task waiting", () => {
  it("cancels a job waiting for the CLI and restores the chapter", async () => {
    const job = await db.prisma.jobRecord.create({
      data: {
        bullmqJobId: "waiting-1",
        jobType: "ANALYZE_CHAPTER",
        entityType: "CHAPTER",
        entityId: chapterIds[1]!,
        status: "QUEUED",
      },
    });
    const result = await analysis.runChapterAnalysis({
      chapterId: chapterIds[1]!,
      jobRecordId: job.id,
      force: false,
      provider: new LocalCliTaskProvider(),
    });
    expect(result).toMatchObject({ waitingForCli: true });
    await db.prisma.jobRecord.update({ where: { id: job.id }, data: { status: "WAITING_FOR_CLI" } });
    expect(fs.existsSync(path.join(env.dataDir, "ai-tasks", job.id, "prompt.md"))).toBe(true);

    await expect(jobControl.cancelJob(job.id)).resolves.toMatchObject({ status: "CANCELLED" });
    const chapter = await db.prisma.chapter.findUniqueOrThrow({ where: { id: chapterIds[1] } });
    expect(chapter.analysisStatus).toBe("NOT_ANALYZED");
    expect(await db.prisma.aiRun.count({ where: { jobRecordId: job.id, status: "FAILED" } })).toBe(1);
    await expect(jobControl.cancelJob(job.id)).rejects.toMatchObject({ code: "JOB_NOT_CANCELLABLE" });
  });
});

describe("voiceover fallbacks and duration limits", () => {
  let videoId: string;
  let sceneIds: string[];

  beforeAll(async () => {
    await analysis.runChapterAnalysis({ chapterId: chapterIds[2]!, jobRecordId: null, force: false });
    const lesson = await db.prisma.lesson.findFirstOrThrow({ where: { bookId, status: "DRAFT" } });
    await db.prisma.lesson.update({ where: { id: lesson.id }, data: { status: "APPROVED" } });
    const { video } = await videos.createVideo({
      bookId,
      title: "Video 30 giây",
      description: null,
      lessonIds: [lesson.id],
      minDurationSec: 30,
      maxDurationSec: 30,
    });
    videoId = video.id;
    await generation.runScriptGeneration({ videoId, jobRecordId: null });
    sceneIds = (await videos.getVideo(videoId)).scenes.map((scene) => scene.id);
  });

  it("reports an unavailable edge-tts clearly so the user can upload instead", async () => {
    await expect(tts.runSceneTts({ sceneId: sceneIds[1]! })).rejects.toMatchObject({ code: "TTS_UNAVAILABLE" });
  });

  it("accepts an uploaded WAV, times the scene from it and rejects files that are not audio", async () => {
    const wav = makeWav(path.join(env.dataDir, "probe.wav"), 2);
    await audio.uploadSceneAudio(sceneIds[1]!, { name: "giong-doc.wav", type: "audio/wav", bytes: wav });
    const scene = (await videos.getVideo(videoId)).scenes[1]!;
    expect(scene.audio).toMatchObject({ provider: "upload", durationMs: 2000 });
    expect(scene.durationFrames).toBe(69);

    await expect(
      audio.uploadSceneAudio(sceneIds[1]!, {
        name: "x.mp3",
        type: "audio/mpeg",
        bytes: new TextEncoder().encode("not audio"),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_AUDIO" });
  });

  it("blocks a final render when real audio overruns the preset and never raises the preset itself", async () => {
    const long = makeWav(path.join(env.dataDir, "long.wav"), 40);
    await audio.uploadSceneAudio(sceneIds[2]!, { name: "dai.wav", type: "audio/wav", bytes: long });
    await videos.approveScript(videoId).catch(() => undefined);
    const video = await videos.getVideo(videoId);

    expect(video.targetDurationSec).toBe(30);
    expect(video.budget.level).toBe("over");
    const final = renders.preflightFor(video, "FINAL");
    expect(final.blocking.map((issue) => issue.code)).toContain("OVER_TARGET");
    expect(renders.preflightFor(video, "DRAFT").blocking.map((issue) => issue.code)).not.toContain("OVER_TARGET");
  });

  it("drops stale narration audio only when the narration text changes", async () => {
    const editing = await import("@/features/videos/services/script-editing.service");
    const scene = (await videos.getVideo(videoId)).scenes[1]!;
    const kept = await editing.updateScene(videoId, scene.id, { ...scene, onScreenText: "CHỮ MỚI", hidden: false });
    expect(kept.scenes[1]?.audioAssetId).toBe(scene.audioAssetId);
    expect(kept.scenes[1]?.durationFrames).toBe(scene.durationFrames);

    const changed = await editing.updateScene(videoId, scene.id, {
      ...scene,
      narration: "Lời dẫn đã sửa.",
      hidden: false,
    });
    expect(changed.scenes[1]?.audioAssetId).toBeNull();
  });
});
