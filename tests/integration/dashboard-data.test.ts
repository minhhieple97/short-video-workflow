import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as SystemStatus from "@/features/jobs/services/system-status.service";
import type * as ScriptGeneration from "@/features/videos/services/script-generation.service";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as DbClient from "@/server/db/client";
import { JOB_STATUSES } from "@/shared/types/job";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let status: typeof SystemStatus;
let videos: typeof VideoService;
let generation: typeof ScriptGeneration;
let videoId: string;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  status = await import("@/features/jobs/services/system-status.service");
  videos = await import("@/features/videos/services/video.service");
  generation = await import("@/features/videos/services/script-generation.service");
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
  videoId = (
    await videos.createVideo({
      bookId,
      title: "Video thẻ",
      description: null,
      lessonIds: [lesson!.id],
      targetDurationSec: 30,
      extended: false,
    })
  ).video.id;
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("system status for the sidebar", () => {
  it("counts only unfinished jobs and reports a stopped worker when no heartbeat can be read", async () => {
    for (const jobStatus of JOB_STATUSES) {
      await db.prisma.jobRecord.create({
        data: {
          bullmqJobId: `status-${jobStatus}`,
          jobType: "DIAGNOSTIC_PING",
          entityType: "SYSTEM",
          entityId: "system",
          status: jobStatus,
        },
      });
    }

    // Redis is unreachable in tests (see setupTestEnvironment): the sidebar must degrade, not throw.
    await expect(status.getSystemStatus()).resolves.toEqual({ worker: "stopped", activeJobs: 4, aiMode: "mock" });
  });
});

describe("video cards", () => {
  it("shows no hook until a script exists, then the HOOK scene's on-screen text", async () => {
    expect((await videos.listVideos()).find((video) => video.id === videoId)?.hookText).toBeNull();

    await generation.runScriptGeneration({ videoId, jobRecordId: null });

    const detail = await videos.getVideo(videoId);
    const hook = detail.scenes.find((scene) => scene.type === "HOOK");
    expect(hook?.onScreenText).toBeTruthy();
    expect((await videos.listVideos()).find((video) => video.id === videoId)?.hookText).toBe(hook?.onScreenText);
  });
});
