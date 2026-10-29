import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as BookImportService from "@/features/books/services/book-import.service";
import type * as ChapterAnalysisService from "@/features/chapters/services/chapter-analysis.service";
import type * as ChapterService from "@/features/chapters/services/chapter.service";
import type * as LessonService from "@/features/lessons/services/lesson.service";
import { publishMetadataSchema } from "@/features/videos/domain/publish-metadata";
import type * as PublishGeneration from "@/features/videos/services/publish-generation.service";
import type * as PublishRequest from "@/features/videos/services/publish-request.service";
import type * as ScriptEditing from "@/features/videos/services/script-editing.service";
import type * as ScriptGeneration from "@/features/videos/services/script-generation.service";
import type * as VideoService from "@/features/videos/services/video.service";
import type * as TaskFiles from "@/server/ai/cli-task/task-files";
import type { PublishMetadataInput } from "@/server/ai/contracts/publish-metadata";
import type { VideoScriptInput } from "@/server/ai/contracts/video-script";
import type * as CliProvider from "@/server/ai/local-cli-task-provider";
import { MockAiProvider } from "@/server/ai/mock-ai-provider";
import type * as DbClient from "@/server/db/client";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let videos: typeof VideoService;
let editing: typeof ScriptEditing;
let generation: typeof ScriptGeneration;
let publishGeneration: typeof PublishGeneration;
let publishRequest: typeof PublishRequest;
let taskFiles: typeof TaskFiles;
let cli: typeof CliProvider;
let db: typeof DbClient;
let bookId: string;
let lessonId: string;

class NoPublishAi extends MockAiProvider {
  override async generateVideoScript(input: VideoScriptInput) {
    const result = await super.generateVideoScript(input);
    if (result.status !== "completed") return result;
    return { ...result, output: { ...result.output, publish: undefined } };
  }
}

class MadeUpNumberAi extends MockAiProvider {
  override async generatePublishMetadata(input: PublishMetadataInput) {
    const result = await super.generatePublishMetadata(input);
    if (result.status !== "completed") return result;
    const publish = { ...result.output.publish, title: "3 bí mật ít ai biết" };
    return { ...result, output: { ...result.output, publish } };
  }
}

beforeAll(async () => {
  env = setupTestEnvironment();
  const importService: typeof BookImportService = await import("@/features/books/services/book-import.service");
  const analysis: typeof ChapterAnalysisService = await import("@/features/chapters/services/chapter-analysis.service");
  const chapters: typeof ChapterService = await import("@/features/chapters/services/chapter.service");
  const lessons: typeof LessonService = await import("@/features/lessons/services/lesson.service");
  videos = await import("@/features/videos/services/video.service");
  editing = await import("@/features/videos/services/script-editing.service");
  generation = await import("@/features/videos/services/script-generation.service");
  publishGeneration = await import("@/features/videos/services/publish-generation.service");
  publishRequest = await import("@/features/videos/services/publish-request.service");
  taskFiles = await import("@/server/ai/cli-task/task-files");
  cli = await import("@/server/ai/local-cli-task-provider");
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
    author: "Tác giả mẫu",
    description: null,
    allowDuplicate: false,
    chapters: preview.sections.filter((s) => s.include).map(({ title, start, end }) => ({ title, start, end })),
  }));
  const [chapter] = await chapters.listChapters(bookId);
  await analysis.runChapterAnalysis({ chapterId: chapter?.id ?? "", jobRecordId: null, force: false });
  const [lesson] = await lessons.listLessons(bookId);
  lessonId = lesson?.id ?? "";
  await lessons.changeLessonStatus(lessonId, "APPROVED");
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

async function scriptedVideo(): Promise<string> {
  const { video } = await videos.createVideo({
    bookId,
    title: "Video đăng",
    description: null,
    lessonIds: [lessonId],
    minDurationSec: 30,
    maxDurationSec: 60,
  });
  await generation.runScriptGeneration({ videoId: video.id, jobRecordId: null, provider: new NoPublishAi() });
  return video.id;
}

const runningJob = (jobType: string, videoId: string, bullmqJobId: string) =>
  db.prisma.jobRecord.create({
    data: { bullmqJobId, jobType, entityType: "VIDEO", entityId: videoId, status: "QUEUED" },
  });

describe("writing a new title, caption and hashtags", () => {
  it("stores the AI's set for the script as it is now and records the AI run", async () => {
    const videoId = await scriptedVideo();
    expect((await videos.getVideo(videoId)).publish).toBeNull();

    await expect(
      publishGeneration.runPublishMetadataGeneration({ videoId, jobRecordId: null, provider: new MockAiProvider() }),
    ).resolves.toEqual({ hashtags: 5 });

    const { publish } = await videos.getVideo(videoId);
    expect(publish).toMatchObject({ origin: "AI", outdated: false });
    expect(publish?.caption).toContain("Sách: Sách mẫu – Tác giả mẫu");
    const row = await db.prisma.videoPublishMetadata.findUniqueOrThrow({ where: { videoId } });
    expect(row.promptVersion).toBe("publish-metadata-v1");
    const run = await db.prisma.aiRun.findFirstOrThrow({ where: { promptVersion: "publish-metadata-v1" } });
    expect(run.status).toBe("COMPLETED");
  });

  it("replaces a set edited by hand", async () => {
    const videoId = await scriptedVideo();
    await publishRequest.savePublishMetadata(
      videoId,
      publishMetadataSchema.parse({ title: "Tiêu đề tự viết", caption: "Caption tự viết.", hashtags: ["a", "b", "c"] }),
    );

    await publishGeneration.runPublishMetadataGeneration({
      videoId,
      jobRecordId: null,
      provider: new MockAiProvider(),
    });

    const { publish } = await videos.getVideo(videoId);
    expect(publish?.origin).toBe("AI");
    expect(publish?.title).not.toBe("Tiêu đề tự viết");
  });

  it("fails and keeps the current set when the AI makes up a number", async () => {
    const videoId = await scriptedVideo();
    await publishGeneration.runPublishMetadataGeneration({
      videoId,
      jobRecordId: null,
      provider: new MockAiProvider(),
    });
    const before = (await videos.getVideo(videoId)).publish;

    await expect(
      publishGeneration.runPublishMetadataGeneration({ videoId, jobRecordId: null, provider: new MadeUpNumberAi() }),
    ).rejects.toMatchObject({ code: "PUBLISH_METADATA_UNSUPPORTED_CLAIM", details: { numbers: ["3"] } });
    expect((await videos.getVideo(videoId)).publish).toEqual(before);
  });

  it("waits for Claude Code, then stores the answer `pnpm ai:run` saved", async () => {
    const videoId = await scriptedVideo();
    const job = await runningJob("GENERATE_PUBLISH_METADATA", videoId, "publish-cli-job");
    const resume = { jobType: "GENERATE_PUBLISH_METADATA" as const, payload: { videoId } };
    const provider = new cli.LocalCliTaskProvider();

    await expect(
      publishGeneration.runPublishMetadataGeneration({ videoId, jobRecordId: job.id, provider, resume }),
    ).resolves.toMatchObject({ waitingForCli: true });
    expect(await taskFiles.readTaskMeta(job.id)).toMatchObject({ kind: "publish-metadata", resume });

    expect(await taskFiles.readTaskText(job.id, "prompt.md")).toContain("<<<BEGIN_UNTRUSTED_SOURCE_TEXT>>>");
    const inputPath = path.join(env.dataDir, "ai-tasks", job.id, "input.json");
    const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as PublishMetadataInput;
    const answer = await new MockAiProvider().generatePublishMetadata(input);
    if (answer.status !== "completed") throw new Error("The mock always completes.");
    await taskFiles.writeTaskOutput(job.id, answer.output);

    await expect(
      publishGeneration.runPublishMetadataGeneration({ videoId, jobRecordId: job.id, provider, resume }),
    ).resolves.toEqual({ hashtags: answer.output.publish.hashtags.length });
    expect((await videos.getVideo(videoId)).publish?.title).toBe(answer.output.publish.title);
    await db.prisma.jobRecord.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
  });

  it("is not offered before the video has a script", async () => {
    const { video } = await videos.createVideo({
      bookId,
      title: "Chưa có kịch bản",
      description: null,
      lessonIds: [lessonId],
      minDurationSec: 30,
      maxDurationSec: 60,
    });
    await expect(publishRequest.requestPublishMetadataGeneration(video.id)).rejects.toMatchObject({
      code: "SCRIPT_EMPTY",
    });
  });
});

describe("saving an edited set", () => {
  it("normalizes the tags and is current again for the script it was saved against", async () => {
    const videoId = await scriptedVideo();
    await publishGeneration.runPublishMetadataGeneration({
      videoId,
      jobRecordId: null,
      provider: new MockAiProvider(),
    });
    const scene = (await videos.getVideo(videoId)).scenes[1];
    if (!scene) throw new Error("The mock script has story scenes.");
    const edited = await editing.updateScene(videoId, scene.id, { ...scene, narration: "Một lời dẫn khác hẳn." });
    expect(edited.publish?.outdated).toBe(true);

    const saved = await publishRequest.savePublishMetadata(
      videoId,
      publishMetadataSchema.parse({
        title: "Bắt đầu nhỏ",
        caption: "Một việc nhỏ mỗi ngày.",
        hashtags: ["#Sách Hay", "#BàiHọc", "sachhay", "đọc sách"],
      }),
    );

    expect(saved.publish).toMatchObject({
      origin: "EDITED",
      outdated: false,
      hashtags: ["sachhay", "baihoc", "docsach"],
    });
  });

  it("is refused while the AI is rewriting the set", async () => {
    const videoId = await scriptedVideo();
    const job = await runningJob("GENERATE_PUBLISH_METADATA", videoId, "publish-busy-job");
    const metadata = publishMetadataSchema.parse({ title: "Tiêu đề", caption: "Caption.", hashtags: ["a", "b", "c"] });

    await expect(publishRequest.savePublishMetadata(videoId, metadata)).rejects.toMatchObject({
      code: "PUBLISH_GENERATION_IN_PROGRESS",
    });
    await db.prisma.jobRecord.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    await expect(publishRequest.savePublishMetadata(videoId, metadata)).resolves.toMatchObject({
      publish: { origin: "EDITED" },
    });
  });
});
