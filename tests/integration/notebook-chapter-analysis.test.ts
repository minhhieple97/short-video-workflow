import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Analysis from "@/features/chapters/services/notebook-chapter-analysis.service";
import type * as PartAnswers from "@/features/chapters/services/notebook-part-answers.service";
import { assembleCanonicalMarkdown } from "@/features/extraction/domain/canonical-document";
import type * as DbClient from "@/server/db/client";
import { ANALYSIS_PERSONA } from "@/server/script-studio/notebooklm/prompts/chat-persona-prompt";
import { LESSON_EXTRACTION_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";

import { fakeNotebookLm, notebookAnswer, type FakeNotebookLm } from "../helpers/fake-notebooklm";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let analysis: typeof Analysis;
let partAnswers: typeof PartAnswers;
let nlm: FakeNotebookLm;

const SENTENCE_ONE = "Thói quen nhỏ cộng dồn thành kết quả lớn theo thời gian.";
const SENTENCE_TWO = "Hãy thiết kế môi trường để lựa chọn tốt trở nên dễ dàng nhất.";
const FILLER = "Đây là một câu đệm để chương đủ dài cho nhiều phần nguồn. ";

const lesson = (title: string, excerpts: { page: number; text: string }[]) => ({
  title,
  summary: "Tóm tắt.",
  principle: "Nguyên tắc.",
  realLifeScenario: "Một tình huống.",
  commonMistake: "Một sai lầm.",
  betterApproach: "Cách tốt hơn.",
  actionableStep: "Một bước.",
  exampleIsIllustrative: false,
  sourceExcerpts: excerpts,
});

// A PDF book whose only chapter covers pages 2-3 of its completed extraction; `fill` makes the chapter long.
async function seedPdfChapter(fill = 0) {
  const pages = [
    { pageNumber: 1, text: "Lời nói đầu." },
    { pageNumber: 2, text: `Chương 1\n${SENTENCE_ONE}\n\n${FILLER.repeat(fill)}` },
    { pageNumber: 3, text: `${SENTENCE_TWO}\n\n${FILLER.repeat(fill)}` },
  ];
  const document = assembleCanonicalMarkdown(pages, 3);
  const start = document.markdown.indexOf("Chương 1");
  const book = await db.prisma.book.create({
    data: {
      title: "Thói quen nguyên tử",
      sourceFilePath: "books/x/original.pdf",
      sourceFileName: "x.pdf",
      sourceHash: `hash-${Math.random()}`,
      sourceFormat: "pdf",
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  await db.prisma.bookExtraction.create({
    data: {
      bookId: book.id,
      status: "COMPLETED",
      sourceHash: "h",
      pageCount: 3,
      completedAt: new Date(),
      pages: { create: pages.map((page) => ({ ...page, status: "EXTRACTED", method: "TEXT" })) },
    },
  });
  const chapter = await db.prisma.chapter.create({
    data: {
      bookId: book.id,
      order: 1,
      title: "Chương 1",
      content: document.markdown.slice(start),
      sourceStartOffset: start,
      sourceEndOffset: document.markdown.length,
      contentHash: createHash("sha256").update(document.markdown.slice(start)).digest("hex"),
      analysisStatus: "QUEUED",
    },
  });
  return { bookId: book.id, chapterId: chapter.id };
}

const run = (chapterId: string, force = false) =>
  analysis.runNotebookChapterAnalysis({ chapterId, jobRecordId: null, force, settings: nlm.settings });
const activeLessons = (bookId: string) =>
  db.prisma.lesson.findMany({
    where: { bookId, status: { not: "ARCHIVED" } },
    include: { sources: true },
    orderBy: { title: "asc" },
  });
const chapterOf = (id: string) => db.prisma.chapter.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  analysis = await import("@/features/chapters/services/notebook-chapter-analysis.service");
  partAnswers = await import("@/features/chapters/services/notebook-part-answers.service");
}, 60_000);

beforeEach(async () => {
  nlm = fakeNotebookLm(path.join(env.dataDir, `nlm-${Math.random().toString(36).slice(2)}`));
  await db.prisma.book.deleteMany();
  await db.prisma.aiRun.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("runNotebookChapterAnalysis", () => {
  it("reads a long chapter part by part and stores each lesson once, with excerpts placed on their PDF page", async () => {
    const { bookId, chapterId } = await seedPdfChapter(400);
    nlm.script({
      notebook_query: [
        notebookAnswer({
          complete: true,
          lessons: [
            lesson("Cộng dồn thói quen nhỏ", [{ page: 9, text: SENTENCE_ONE }]),
            lesson("Bịa ra", [{ page: 2, text: "Câu này không hề có trong sách gốc." }]),
          ],
        }),
        notebookAnswer({
          complete: true,
          lessons: [
            lesson("Thiết kế môi trường", [{ page: 3, text: SENTENCE_TWO }]),
            lesson("cộng dồn thói quen nhỏ", [{ page: 2, text: SENTENCE_ONE }]),
          ],
        }),
      ],
    });

    const result = await run(chapterId);

    const adds = nlm.calls("source_add");
    expect(adds).toHaveLength(2);
    expect(String(adds[0]?.text)).toContain("[Trang 2]");
    const queries = nlm.calls("notebook_query");
    expect(queries).toHaveLength(adds.length);
    expect(String(queries[0]?.query)).toContain(`phần 1/${adds.length}`);
    expect(result).toMatchObject({ skipped: false, lessonsCreated: 3, excerptsRejected: 1, partial: false });

    const lessons = await activeLessons(bookId);
    expect(lessons.map((item) => item.title)).toEqual(["Bịa ra", "Cộng dồn thói quen nhỏ", "Thiết kế môi trường"]);
    const [invented, merged, environment] = lessons;
    // The model said page 9; the excerpt is on page 2, and that is what is stored.
    expect(merged?.sources).toHaveLength(1);
    expect(merged?.sources[0]?.sourceLocator).toMatch(/^page:2;offset:\d+$/);
    expect(environment?.sources[0]?.sourceLocator).toMatch(/^page:3;offset:\d+$/);
    expect(invented?.sources).toMatchObject([{ sourceExcerpt: null, sourceLocator: null }]);
    expect(await chapterOf(chapterId)).toMatchObject({
      analysisStatus: "ANALYZED",
      analysisPromptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
    });
    expect(await db.prisma.aiRun.findFirst({ where: { mode: "notebooklm" } })).toMatchObject({ status: "COMPLETED" });
    // The catalogue is asked under the short analysis persona, never the long one that holds a draft's rules.
    expect(nlm.remote().notebooks[0]?.chat?.custom_prompt).toBe(ANALYSIS_PERSONA.prompt);
  });

  it("does not ask again while up to date, and a forced run replaces the drafts instead of adding to them", async () => {
    const { bookId, chapterId } = await seedPdfChapter();
    const answer = notebookAnswer({ complete: true, lessons: [lesson("Cộng dồn", [{ page: 2, text: SENTENCE_ONE }])] });
    nlm.script({ notebook_query: [answer, answer] });
    await run(chapterId);

    await expect(run(chapterId)).resolves.toMatchObject({ skipped: true });
    expect(nlm.calls("notebook_query")).toHaveLength(1);

    await run(chapterId, true);
    expect(nlm.calls("notebook_query")).toHaveLength(2);
    expect(await activeLessons(bookId)).toHaveLength(1);
    // The same text is the same source revision: it is not uploaded twice.
    expect(nlm.calls("source_add")).toHaveLength(1);
  });

  it("marks a chapter PARTIAL, not analysed, when the reader stopped early", async () => {
    const { bookId, chapterId } = await seedPdfChapter();
    nlm.script({
      notebook_query: [
        notebookAnswer({ complete: false, lessons: [lesson("Cộng dồn", [{ page: 2, text: SENTENCE_ONE }])] }),
      ],
    });

    await expect(run(chapterId)).resolves.toMatchObject({ partial: true, lessonsCreated: 1 });
    expect(await chapterOf(chapterId)).toMatchObject({ analysisStatus: "PARTIAL" });
    expect(await activeLessons(bookId)).toHaveLength(1);
  });

  describe("a retry after a later part timed out", () => {
    const wholeAnswer = (title: string, excerpt: { page: number; text: string }, complete = true) =>
      notebookAnswer({ complete, lessons: [lesson(title, [excerpt])] });
    const partOne = (complete = true) =>
      wholeAnswer("Cộng dồn thói quen nhỏ", { page: 2, text: SENTENCE_ONE }, complete);
    const partTwo = () => wholeAnswer("Thiết kế môi trường", { page: 3, text: SENTENCE_TWO });
    // The second part's question is never answered: the call is given up on after one second.
    const runUntilSecondPartTimesOut = async (chapterId: string, firstAnswer: Record<string, unknown>) => {
      nlm.script({ notebook_query: [firstAnswer, { __hang: true }] });
      await expect(
        analysis.runNotebookChapterAnalysis({
          chapterId,
          jobRecordId: null,
          force: false,
          settings: { ...nlm.settings, callTimeoutMs: 1_000 },
        }),
      ).rejects.toMatchObject({ code: "MCP_TIMEOUT", kind: "TRANSIENT" });
    };

    it("asks only the parts it has not answered, and keeps how long each question took or why it failed", async () => {
      const { bookId, chapterId } = await seedPdfChapter(400);
      await runUntilSecondPartTimesOut(chapterId, partOne());
      expect(await chapterOf(chapterId)).toMatchObject({ analysisStatus: "FAILED" });
      expect(nlm.calls("notebook_query")).toHaveLength(2);

      nlm.script({ notebook_query: [partTwo()] });
      await expect(run(chapterId)).resolves.toMatchObject({ skipped: false, lessonsCreated: 2, partial: false });

      const queries = nlm.calls("notebook_query");
      expect(queries).toHaveLength(3);
      expect(String(queries[2]?.query)).toContain("phần 2/2");
      expect((await activeLessons(bookId)).map((item) => item.title)).toEqual([
        "Cộng dồn thói quen nhỏ",
        "Thiết kế môi trường",
      ]);
      expect(await chapterOf(chapterId)).toMatchObject({ analysisStatus: "ANALYZED" });
      const partRuns = await db.prisma.aiRun.findMany({
        where: { mode: "notebooklm-part" },
        orderBy: { createdAt: "asc" },
      });
      expect(partRuns.map((item) => item.status)).toEqual(["COMPLETED", "FAILED", "COMPLETED"]);
      expect(partRuns[1]?.errorMessage).toContain("notebook_query");
    });

    it("asks a part again when its earlier answer stopped early", async () => {
      const { chapterId } = await seedPdfChapter(400);
      await runUntilSecondPartTimesOut(chapterId, partOne(false));

      nlm.script({ notebook_query: [partOne(), partTwo()] });
      await expect(run(chapterId)).resolves.toMatchObject({ partial: false });

      expect(nlm.calls("notebook_query")).toHaveLength(4);
    });

    it("asks a part again when its stored answer is gone", async () => {
      const { chapterId } = await seedPdfChapter(400);
      await runUntilSecondPartTimesOut(chapterId, partOne());
      const kept = await db.prisma.aiRun.findFirstOrThrow({ where: { mode: "notebooklm-part", status: "COMPLETED" } });
      fs.rmSync(path.join(env.dataDir, kept.outputPath ?? ""));

      nlm.script({ notebook_query: [partOne(), partTwo()] });
      await run(chapterId);

      expect(nlm.calls("notebook_query")).toHaveLength(4);
    });

    it("asks every part again for a forced run once an analysis has finished", async () => {
      const { chapterId } = await seedPdfChapter(400);
      nlm.script({ notebook_query: [partOne(), partTwo(), partOne(), partTwo()] });
      await run(chapterId);
      expect(nlm.calls("notebook_query")).toHaveLength(2);

      await run(chapterId, true);
      expect(nlm.calls("notebook_query")).toHaveLength(4);
    });
  });

  it("stores nothing and fails the chapter when the answer is not the JSON asked for", async () => {
    const { bookId, chapterId } = await seedPdfChapter();
    nlm.script({ notebook_query: [{ status: "success", answer: "Chương này nói về thói quen.", sources_used: [] }] });

    await expect(run(chapterId)).rejects.toMatchObject({ code: "NOTEBOOKLM_LESSONS_INVALID" });
    expect(await activeLessons(bookId)).toEqual([]);
    expect(await chapterOf(chapterId)).toMatchObject({ analysisStatus: "FAILED" });
    expect(await db.prisma.aiRun.findFirst({ where: { mode: "notebooklm" } })).toMatchObject({ status: "FAILED" });
  });

  it("is chosen only for PDF books, and only when NotebookLM is set up", async () => {
    const { chapterId } = await seedPdfChapter();
    const textBook = await db.prisma.book.create({
      data: {
        title: "Sách chữ",
        sourceFilePath: "books/t/original.md",
        sourceFileName: "t.md",
        sourceHash: "hash-text",
        sourceFormat: "md",
        sourceSizeBytes: 1,
        status: "ACTIVE",
        chapters: { create: { order: 1, title: "Một", content: "x", contentHash: "h", analysisStatus: "QUEUED" } },
      },
      include: { chapters: true },
    });

    await expect(analysis.notebookAnalysisSettingsFor(chapterId, nlm.settings)).resolves.toBe(nlm.settings);
    await expect(
      analysis.notebookAnalysisSettingsFor(textBook.chapters[0]?.id ?? "", nlm.settings),
    ).resolves.toBeNull();
    await expect(analysis.notebookAnalysisSettingsFor(chapterId, null)).resolves.toBeNull();
  });
});

describe("notebookPartInputHash", () => {
  const question = {
    bookTitle: "Sách",
    chapterTitle: "Chương 1",
    partNumber: 1,
    partCount: 2,
    pages: { first: 2, last: 9 },
    markdown: "Văn bản của phần.",
  };

  it("changes with anything the answer is written from, and with nothing else", () => {
    const hash = partAnswers.notebookPartInputHash(question);

    expect(partAnswers.notebookPartInputHash({ ...question })).toBe(hash);
    for (const changed of [
      { markdown: "Văn bản khác của phần." },
      { chapterTitle: "Chương 2" },
      { bookTitle: "Sách khác" },
      { partNumber: 2 },
      { partCount: 3 },
      { pages: { first: 2, last: 10 } },
    ]) {
      expect(partAnswers.notebookPartInputHash({ ...question, ...changed })).not.toBe(hash);
    }
  });
});
