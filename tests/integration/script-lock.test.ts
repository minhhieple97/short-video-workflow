import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as AudioRequest from "@/features/videos/services/audio-request.service";
import type * as AudioService from "@/features/videos/services/audio.service";
import type * as RenderRequest from "@/features/videos/services/render-request.service";
import type * as ScriptEditing from "@/features/videos/services/script-editing.service";
import type * as ScriptGeneration from "@/features/videos/services/script-generation.service";
import type * as ScriptRequest from "@/features/videos/services/script-request.service";
import type * as VideoService from "@/features/videos/services/video.service";
import type { VideoDetail } from "@/features/videos/schemas/video.dto";
import type * as DbClient from "@/server/db/client";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let videos: typeof VideoService;
let editing: typeof ScriptEditing;
let generation: typeof ScriptGeneration;
let audio: typeof AudioService;
let audioRequest: typeof AudioRequest;
let renderRequest: typeof RenderRequest;
let scriptRequest: typeof ScriptRequest;
let video: VideoDetail;
let jobRecordId: string;

beforeAll(async () => {
  env = setupTestEnvironment();
  process.env.TTS_MODE = "edge-tts";
  db = await import("@/server/db/client");
  videos = await import("@/features/videos/services/video.service");
  editing = await import("@/features/videos/services/script-editing.service");
  generation = await import("@/features/videos/services/script-generation.service");
  audio = await import("@/features/videos/services/audio.service");
  audioRequest = await import("@/features/videos/services/audio-request.service");
  renderRequest = await import("@/features/videos/services/render-request.service");
  scriptRequest = await import("@/features/videos/services/script-request.service");
  const importService = await import("@/features/books/services/book-import.service");
  const chapters = await import("@/features/chapters/services/chapter.service");
  const analysis = await import("@/features/chapters/services/chapter-analysis.service");
  const lessons = await import("@/features/lessons/services/lesson.service");

  const preview = await importService.previewImport({
    kind: "file",
    fileName: "sample.md",
    mimeType: "text/markdown",
    bytes: new Uint8Array(fs.readFileSync(SAMPLE_BOOK_PATH)),
  });
  const { bookId } = await importService.confirmImport({
    importId: preview.importId,
    title: "Sách mẫu",
    author: null,
    description: null,
    allowDuplicate: false,
    chapters: preview.sections.filter((s) => s.include).map(({ title, start, end }) => ({ title, start, end })),
  });
  const [chapter] = await chapters.listChapters(bookId);
  await analysis.runChapterAnalysis({ chapterId: chapter!.id, jobRecordId: null, force: false });
  const [lesson] = await lessons.listLessons(bookId);
  await lessons.changeLessonStatus(lesson!.id, "APPROVED");

  const created = await videos.createVideo({
    bookId,
    title: "Video khoá",
    description: null,
    lessonIds: [lesson!.id],
    targetDurationSec: 60,
    extended: false,
  });
  await generation.runScriptGeneration({ videoId: created.video.id, jobRecordId: null });
  video = await videos.getVideo(created.video.id);

  // "Tạo lại kịch bản" was clicked: a script job for this video is now running.
  const job = await db.prisma.jobRecord.create({
    data: {
      bullmqJobId: "script-lock-job",
      jobType: "GENERATE_VIDEO_SCRIPT",
      entityType: "VIDEO",
      entityId: video.id,
      status: "RUNNING",
    },
  });
  jobRecordId = job.id;
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("while a script is being generated", () => {
  it("rejects every change to the video with SCRIPT_GENERATION_IN_PROGRESS", async () => {
    const [hook, body] = video.scenes;
    const sceneInput = {
      title: null,
      narration: "Lời dẫn mới.",
      onScreenText: "CHỮ MỚI",
      visualVariant: body!.visualVariant,
      hidden: false,
    };
    const attempts: Record<string, () => Promise<unknown>> = {
      "settings (title, duration, Extended)": () =>
        videos.updateVideo(video.id, {
          title: "Tiêu đề mới",
          description: null,
          platformPreviewMode: null,
          targetDurationSec: 90,
          extended: true,
        }),
      "delete video": () => videos.deleteVideo(video.id),
      "approve script": () => videos.approveScript(video.id),
      "render draft": () => renderRequest.requestRender(video.id, "DRAFT"),
      "choose hook": () => editing.selectHookOption(video.id, 1),
      "edit scene": () => editing.updateScene(video.id, body!.id, sceneInput),
      "add scene": () => editing.addScene(video.id, { type: "SUMMARY", afterSceneId: null }),
      "delete scene": () => editing.deleteScene(video.id, body!.id),
      "reorder scenes": () =>
        editing.reorderScenes(
          video.id,
          video.scenes.map((scene) => scene.id),
        ),
      "rewrite one scene": () => scriptRequest.requestSceneRegeneration(video.id, body!.id),
      "scene voiceover": () => audioRequest.requestSceneTts(hook!.id),
      "missing voiceovers": () => audioRequest.requestMissingTts(video.id),
      "upload audio": () =>
        audio.uploadSceneAudio(hook!.id, { name: "a.wav", type: "audio/wav", bytes: new Uint8Array(16) }),
      "remove audio": () => audio.detachSceneAudio(hook!.id),
    };

    for (const [action, attempt] of Object.entries(attempts)) {
      await expect(attempt(), action).rejects.toMatchObject({ code: "SCRIPT_GENERATION_IN_PROGRESS", httpStatus: 409 });
    }

    const after = await videos.getVideo(video.id);
    expect(after).toMatchObject({ title: video.title, targetDurationSec: 60, scriptVersion: video.scriptVersion });
    expect(after.scenes).toEqual(video.scenes);
    expect(await db.prisma.renderRecord.count()).toBe(0);
  });

  it("still lets the worker write the script of that same job", async () => {
    await expect(generation.runScriptGeneration({ videoId: video.id, jobRecordId })).resolves.toMatchObject({
      scenes: 6,
    });
    expect((await videos.getVideo(video.id)).scriptVersion).toBeGreaterThan(video.scriptVersion);
  });

  it("unlocks the video once the job settles", async () => {
    await db.prisma.jobRecord.update({ where: { id: jobRecordId }, data: { status: "COMPLETED" } });
    await expect(
      videos.updateVideo(video.id, {
        title: "Tiêu đề mới",
        description: null,
        platformPreviewMode: null,
        targetDurationSec: 45,
        extended: false,
      }),
    ).resolves.toMatchObject({ title: "Tiêu đề mới", targetDurationSec: 45 });
  });
});
