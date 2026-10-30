import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as Overview from "@/features/chapters/services/analysis-overview.service";
import type * as ChapterAnalysis from "@/features/chapters/services/chapter-analysis.service";
import type * as DbClient from "@/server/db/client";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let overview: typeof Overview;
let analysis: typeof ChapterAnalysis;
let bookId: string;
let chapterIds: string[];
const TITLE = "Sách mẫu";

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  overview = await import("@/features/chapters/services/analysis-overview.service");
  analysis = await import("@/features/chapters/services/chapter-analysis.service");
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
    title: TITLE,
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

describe("getBookAnalysisOverview", () => {
  it("counts a fresh book as entirely to analyse", async () => {
    const result = await overview.getBookAnalysisOverview(bookId, TITLE);

    expect(chapterIds.length).toBeGreaterThanOrEqual(3);
    expect(result).toMatchObject({
      total: chapterIds.length,
      notAnalyzed: chapterIds.length,
      needsAnalysis: chapterIds.length,
      outdated: 0,
      currentChapter: null,
    });
    expect(result.needsAnalysisIds).toEqual(chapterIds);
  });

  it("leaves out a chapter analysed for the current input and one the worker is on, and names the latter", async () => {
    await analysis.runChapterAnalysis({ chapterId: chapterIds[0]!, jobRecordId: null, force: false });
    await db.prisma.chapter.update({ where: { id: chapterIds[1]! }, data: { analysisStatus: "ANALYZING" } });
    const running = await db.prisma.chapter.findUniqueOrThrow({ where: { id: chapterIds[1]! } });

    const result = await overview.getBookAnalysisOverview(bookId, TITLE);

    expect(result).toMatchObject({
      analyzed: 1,
      analyzing: 1,
      needsAnalysis: chapterIds.length - 2,
      outdated: 0,
    });
    expect(result.currentChapter).toContain(running.title);
    expect(result.needsAnalysisIds).toEqual(chapterIds.slice(2));
  });

  it("counts a chapter analysed with an older prompt as both analysed and due again, as a click would treat it", async () => {
    await db.prisma.chapter.update({ where: { id: chapterIds[1]! }, data: { analysisStatus: "NOT_ANALYZED" } });
    await db.prisma.chapter.update({
      where: { id: chapterIds[0]! },
      data: { analysisPromptVersion: "chapter-analysis-v0" },
    });

    const result = await overview.getBookAnalysisOverview(bookId, TITLE);

    expect(result).toMatchObject({ analyzed: 1, outdated: 1, needsAnalysis: chapterIds.length, currentChapter: null });
    expect(result.needsAnalysisIds).toEqual(chapterIds);
  });
});
