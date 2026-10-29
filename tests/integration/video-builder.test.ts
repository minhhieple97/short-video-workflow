import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as BookImportService from "@/features/books/services/book-import.service";
import type * as ChapterAnalysisService from "@/features/chapters/services/chapter-analysis.service";
import type * as ChapterService from "@/features/chapters/services/chapter.service";
import type * as LessonService from "@/features/lessons/services/lesson.service";
import type * as ScriptEditing from "@/features/videos/services/script-editing.service";
import type * as ScriptGeneration from "@/features/videos/services/script-generation.service";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as DbClient from "@/server/db/client";
import type { SceneRegenerationInput, VideoScriptInput } from "@/server/ai/contracts/video-script";
import { MockAiProvider } from "@/server/ai/mock-ai-provider";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

// Modules are imported after setupTestEnvironment() so they read the temporary database configuration.
let env: TestEnvironment;
let videos: typeof VideoService;
let editing: typeof ScriptEditing;
let generation: typeof ScriptGeneration;
let lessons: typeof LessonService;
let db: typeof DbClient;
let bookId: string;
let approved: string[];
let draftLessonId: string;

beforeAll(async () => {
  env = setupTestEnvironment();
  const importService: typeof BookImportService = await import("@/features/books/services/book-import.service");
  const analysis: typeof ChapterAnalysisService = await import("@/features/chapters/services/chapter-analysis.service");
  const chapters: typeof ChapterService = await import("@/features/chapters/services/chapter.service");
  lessons = await import("@/features/lessons/services/lesson.service");
  videos = await import("@/features/videos/services/video.service");
  editing = await import("@/features/videos/services/script-editing.service");
  generation = await import("@/features/videos/services/script-generation.service");
  db = await import("@/server/db/client");

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
  for (const chapter of await chapters.listChapters(bookId)) {
    await analysis.runChapterAnalysis({ chapterId: chapter.id, jobRecordId: null, force: false });
  }
  const all = await lessons.listLessons(bookId);
  approved = [all[0]!.id, all[2]!.id, all[4]!.id];
  for (const id of approved) await lessons.changeLessonStatus(id, "APPROVED");
  draftLessonId = all[1]!.id;
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

const create = (lessonIds: string[], targetDurationSec: 30 | 45 | 60 | 90 = 60) =>
  videos.createVideo({
    bookId,
    title: `Video ${lessonIds.length}`,
    description: null,
    lessonIds,
    targetDurationSec,
    extended: targetDurationSec === 90,
  });

describe("creating videos from lessons", () => {
  it("accepts only approved lessons from the same book", async () => {
    await expect(create([draftLessonId])).rejects.toMatchObject({ code: "LESSON_NOT_APPROVED" });
    await expect(create(["missing-lesson"])).rejects.toMatchObject({ code: "LESSON_NOT_IN_BOOK" });
  });

  it("builds two different videos from the same book with their own presets (M3 gate)", async () => {
    const a = await create([approved[0]!], 60);
    const b = await create([approved[1]!, approved[2]!], 90);

    expect(a.warnings).toEqual([]);
    expect(b.warnings[0]).toMatch(/2 bài học/);
    expect(a.video).toMatchObject({
      status: "DRAFT",
      targetDurationSec: 60,
      extended: false,
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(b.video).toMatchObject({ targetDurationSec: 90, extended: true });
    expect(b.video.lessons.map((lesson) => lesson.position)).toEqual([1, 2]);
    expect(await videos.listVideos({ bookId })).toHaveLength(2);
    expect((await lessons.getLesson(approved[0]!)).videos.map((video) => video.id)).toEqual([a.video.id]);
  });

  it("keeps the lesson snapshot when the lesson is edited later", async () => {
    const [video] = await videos.listVideos({ bookId });
    const target = (await videos.getVideo(video!.id)).lessons[0]!;
    const lesson = await lessons.getLesson(target.lessonId);
    await lessons.updateLesson(lesson.id, { ...lesson, title: "Tiêu đề đã sửa sau khi tạo video" });

    const after = (await videos.getVideo(video!.id)).lessons[0]!;
    expect(after.title).toBe(target.title);
    expect(after.changedSinceSnapshot).toBe(true);
  });
});

class OutOfOrderAi extends MockAiProvider {
  override async generateVideoScript(input: VideoScriptInput) {
    const result = await super.generateVideoScript(input);
    if (result.status !== "completed") return result;
    const scenes = [...result.output.scenes];
    const [situation, mistake, takeaway, approach, ...rest] = scenes;
    return {
      ...result,
      output: { ...result.output, scenes: [situation!, mistake!, approach!, takeaway!, ...rest] },
    };
  }
}

class PictureSendingAi extends MockAiProvider {
  override async regenerateScene(input: SceneRegenerationInput) {
    const result = await super.regenerateScene(input);
    if (result.status !== "completed") return result;
    const scene = { ...result.output.scene, illustration: { setting: "PARK", action: "WALKING" } as const };
    return { ...result, output: { ...result.output, scene } };
  }
}

describe("script generation and editing", () => {
  let videoId: string;

  it("generates hook options and a storyboard that starts with the HOOK", async () => {
    videoId = (await create([approved[0]!], 60)).video.id;
    await expect(generation.runScriptGeneration({ videoId, jobRecordId: null })).resolves.toEqual({
      scenes: 6,
      hookOptions: 3,
    });
    const video = await videos.getVideo(videoId);
    expect(video.status).toBe("NEEDS_REVIEW");
    expect(video.scenes[0]).toMatchObject({ type: "HOOK", order: 0, hookVariant: "QUESTION" });
    expect(video.hookIssues).toEqual([]);
    expect(video.budget.level).not.toBe("over");
  });

  it("refuses an AI script that does not follow the story frame and keeps the current script", async () => {
    const before = await videos.getVideo(videoId);
    await expect(
      generation.runScriptGeneration({ videoId, jobRecordId: null, provider: new OutOfOrderAi() }),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
    expect((await videos.getVideo(videoId)).scenes).toEqual(before.scenes);
  });

  it("switches the hook without touching the rest of the script", async () => {
    const before = await videos.getVideo(videoId);
    const after = await editing.selectHookOption(videoId, 2);
    expect(after.scenes[0]).toMatchObject({
      type: "HOOK",
      hookVariant: "CONTRAST",
      narration: before.hookOptions[2]!.narration,
    });
    expect(after.scenes[0]!.illustration).toEqual(before.hookOptions[2]!.illustration);
    expect(after.scenes.slice(1)).toEqual(before.scenes.slice(1));
    expect(after.scriptVersion).toBe(before.scriptVersion + 1);
  });

  it("edits or regenerates one scene and leaves every other scene unchanged", async () => {
    const before = await videos.getVideo(videoId);
    const target = before.scenes[2]!;
    const edited = await editing.updateScene(videoId, target.id, {
      title: target.title,
      narration: "Lời dẫn mới cho cảnh sai lầm.",
      onScreenText: "SAI LẦM",
      visualVariant: target.visualVariant,
      hidden: false,
    });
    expect(edited.scenes[2]).toMatchObject({ narration: "Lời dẫn mới cho cảnh sai lầm.", version: target.version + 1 });
    expect(edited.scenes.filter((s) => s.id !== target.id)).toEqual(before.scenes.filter((s) => s.id !== target.id));

    await generation.runSceneRegeneration({ videoId, sceneId: target.id, jobRecordId: null });
    const regenerated = await videos.getVideo(videoId);
    expect(regenerated.scenes[2]!.narration).not.toBe("Lời dẫn mới cho cảnh sai lầm.");
    expect(regenerated.scenes.filter((s) => s.id !== target.id)).toEqual(
      edited.scenes.filter((s) => s.id !== target.id),
    );
  });

  it("lets the user pick a scene's picture, keeps it through other edits and rewrites, and can go back to the default", async () => {
    const target = (await videos.getVideo(videoId)).scenes[1]!;
    expect(target.illustration).toBeNull();
    const fields = {
      title: target.title,
      narration: target.narration,
      onScreenText: target.onScreenText,
      visualVariant: target.visualVariant,
      hidden: false,
    };
    const cafe = { setting: "CAFE", action: "TALKING" } as const;

    const picked = await editing.updateScene(videoId, target.id, { ...fields, illustration: cafe });
    expect(picked.scenes[1]).toMatchObject({ illustration: cafe, version: target.version + 1 });

    const reworded = await editing.updateScene(videoId, target.id, { ...fields, narration: "Một lời dẫn khác." });
    expect(reworded.scenes[1]!.illustration).toEqual(cafe);
    // Even an AI that sends a picture back only rewrites the words.
    await generation.runSceneRegeneration({
      videoId,
      sceneId: target.id,
      jobRecordId: null,
      provider: new PictureSendingAi(),
    });
    expect((await videos.getVideo(videoId)).scenes[1]!.illustration).toEqual(cafe);

    const reset = await editing.updateScene(videoId, target.id, { ...fields, illustration: null });
    expect(reset.scenes[1]!.illustration).toBeNull();
  });

  it("keeps the HOOK first and protected while adding, deleting and reordering scenes", async () => {
    const video = await videos.getVideo(videoId);
    const ids = video.scenes.map((scene) => scene.id);
    await expect(editing.reorderScenes(videoId, [...ids.slice(1), ids[0]!])).rejects.toMatchObject({
      code: "HOOK_REQUIRED",
    });
    await expect(editing.deleteScene(videoId, ids[0]!)).rejects.toMatchObject({ code: "HOOK_REQUIRED" });

    const added = await editing.addScene(videoId, { type: "SUMMARY", afterSceneId: ids[0]! });
    expect(added.scenes.map((scene) => scene.type).slice(0, 2)).toEqual(["HOOK", "SUMMARY"]);
    expect(added.scenes.map((scene) => scene.order)).toEqual(added.scenes.map((_, index) => index));

    const reordered = await editing.reorderScenes(videoId, [
      ids[0]!,
      ...added.scenes
        .slice(1)
        .map((s) => s.id)
        .reverse(),
    ]);
    expect(reordered.scenes.at(-1)?.type).toBe("SUMMARY");

    const removed = await editing.deleteScene(videoId, reordered.scenes.at(-1)!.id);
    expect(removed.scenes).toHaveLength(video.scenes.length);
    expect(removed.scenes.map((scene) => scene.order)).toEqual(removed.scenes.map((_, index) => index));
  });

  it("approves the script and sends it back to review after any edit", async () => {
    const approvedVideo = await videos.approveScript(videoId);
    expect(approvedVideo).toMatchObject({ status: "APPROVED", approvedScriptVersion: approvedVideo.scriptVersion });

    const scene = approvedVideo.scenes[1]!;
    const hidden = await editing.updateScene(videoId, scene.id, { ...scene, hidden: true });
    expect(hidden.status).toBe("NEEDS_REVIEW");
    expect(hidden.scriptVersion).toBeGreaterThan(approvedVideo.scriptVersion);
  });

  it("refuses to approve a script whose hook is longer than three seconds", async () => {
    const hook = (await videos.getVideo(videoId)).scenes[0]!;
    await editing.updateScene(videoId, hook.id, {
      ...hook,
      narration: "Đây là một câu hook quá dài, kéo dài hơn ba giây rất nhiều nên sẽ bị chặn khi duyệt kịch bản.",
    });
    await expect(videos.approveScript(videoId)).rejects.toMatchObject({ code: "HOOK_INVALID" });
  });
});
