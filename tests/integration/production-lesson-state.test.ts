import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as LessonService from "@/features/lessons/services/lesson.service";
import type * as LessonState from "@/features/productions/services/production-lesson-state.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as ProductionSettings from "@/features/productions/services/production-settings.service";
import type * as DbClient from "@/server/db/client";
import type * as Env from "@/shared/config/env";

import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let productions: typeof ProductionRequest;
let state: typeof LessonState;
let settings: typeof ProductionSettings;
let lessons: typeof LessonService;
let appConfig: typeof Env;

let bookId: string;
let batchId: string;
let lessonIds: string[];
let itemIds: string[];

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  productions = await import("@/features/productions/services/production-request.service");
  state = await import("@/features/productions/services/production-lesson-state.service");
  settings = await import("@/features/productions/services/production-settings.service");
  lessons = await import("@/features/lessons/services/lesson.service");
  appConfig = await import("@/shared/config/env");
}, 60_000);

beforeEach(async () => {
  ({ bookId, itemIds } = await seedProduction({ db, productions, lessonCount: 2 }));
  const items = await db.prisma.productionItem.findMany({
    where: { id: { in: itemIds } },
    orderBy: { position: "asc" },
  });
  lessonIds = items.map((item) => item.lessonId);
  batchId = items[0]?.batchId ?? "";
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getActiveProductionsByLesson", () => {
  it("names the production each lesson is being made in, and leaves out lessons that are not", async () => {
    const other = await db.prisma.lesson.create({
      data: {
        bookId,
        title: "Chưa làm",
        summary: "s",
        principle: "p",
        realLifeScenario: "r",
        commonMistake: "m",
        betterApproach: "b",
        actionableStep: "a",
        origin: "AI",
      },
    });

    expect(await state.getActiveProductionsByLesson([...lessonIds, other.id])).toEqual({
      [lessonIds[0] ?? ""]: batchId,
      [lessonIds[1] ?? ""]: batchId,
    });
  });

  it("keeps a lesson while its item is waiting or running", async () => {
    await db.prisma.productionItem.update({ where: { id: itemIds[0] ?? "" }, data: { status: "WAITING" } });
    await db.prisma.productionItem.update({ where: { id: itemIds[1] ?? "" }, data: { status: "RUNNING" } });

    expect(Object.keys(await state.getActiveProductionsByLesson(lessonIds)).sort()).toEqual([...lessonIds].sort());
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED"])("lets a lesson go once its item is %s", async (status) => {
    await db.prisma.productionItem.update({ where: { id: itemIds[0] ?? "" }, data: { status } });

    expect(await state.getActiveProductionsByLesson(lessonIds)).toEqual({ [lessonIds[1] ?? ""]: batchId });
  });

  it("asks nothing of the database for no lessons", async () => {
    expect(await state.getActiveProductionsByLesson([])).toEqual({});
  });
});

describe("lesson summaries for the list", () => {
  it("say which lessons have an excerpt a video can be traced to", async () => {
    const chapter = await db.prisma.chapter.findFirstOrThrow({ where: { bookId } });
    const make = (title: string, excerpts: (string | null)[]) =>
      db.prisma.lesson.create({
        data: {
          bookId,
          title,
          summary: "s",
          principle: "p",
          realLifeScenario: "r",
          commonMistake: "m",
          betterApproach: "b",
          actionableStep: "a",
          origin: "MANUAL",
          sources: { create: excerpts.map((sourceExcerpt) => ({ chapterId: chapter.id, sourceExcerpt })) },
        },
      });
    await make("Chỉ một nguồn có trích đoạn", [null, "Có một đoạn."]);
    await make("Trích đoạn trống", ["   "]);
    await make("Không có nguồn", []);

    const byTitle = new Map(
      (await lessons.listLessonsPage(bookId, {}, { page: 1, pageSize: 20 })).items.map((lesson) => [
        lesson.title,
        lesson.hasSourceExcerpt,
      ]),
    );

    expect(byTitle.get("Bài")).toBe(true);
    expect(byTitle.get("Chỉ một nguồn có trích đoạn")).toBe(true);
    expect(byTitle.get("Trích đoạn trống")).toBe(false);
    expect(byTitle.get("Không có nguồn")).toBe(false);
  });
});

describe("productionUnavailableReason", () => {
  const withAi = (mode: "mock" | "cli-task" | "cli-auto", profile?: string): Env.AppConfig => {
    const base = appConfig.getAppConfig();
    return { ...base, ai: { ...base.ai, mode }, notebookLm: { ...base.notebookLm, profile } };
  };

  it("lets production run offline with the mock", () => {
    expect(settings.productionUnavailableReason(withAi("mock"))).toBeNull();
  });

  it("lets production run with Claude and a signed-in NotebookLM profile", () => {
    expect(settings.productionUnavailableReason(withAi("cli-auto", "toi"))).toBeNull();
  });

  it("says what to set when NotebookLM has no profile", () => {
    expect(settings.productionUnavailableReason(withAi("cli-auto"))).toContain("NOTEBOOKLM_PROFILE");
  });

  it("says that cli-task cannot run a batch, because each task waits for a person", () => {
    expect(settings.productionUnavailableReason(withAi("cli-task"))).toContain("cli-auto");
  });

  it("hands the screens the form's starting values with the reason, if any", () => {
    expect(settings.getProductionSettings(withAi("cli-task"))).toMatchObject({
      defaultPace: "STANDARD",
      defaultRange: { minDurationSec: 30 },
      unavailable: expect.stringContaining("cli-auto"),
    });
    expect(settings.getProductionSettings(withAi("mock")).unavailable).toBeNull();
  });
});
