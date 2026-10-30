import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as AnalysisRequest from "@/features/chapters/services/analysis-request.service";
import type * as NotebookAnalysis from "@/features/chapters/services/notebook-chapter-analysis.service";
import type * as ExtractionRepository from "@/features/extraction/repositories/extraction.repository";
import type * as CanonicalDocument from "@/features/extraction/services/canonical-document.service";
import type * as ExtractionChapters from "@/features/extraction/services/extraction-chapters.service";
import type * as TextLayerRepair from "@/features/extraction/services/text-layer-repair.service";
import type * as DbClient from "@/server/db/client";
import { LESSON_EXTRACTION_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let repo: typeof ExtractionRepository;
let canonical: typeof CanonicalDocument;
let chaptersService: typeof ExtractionChapters;
let repair: typeof TextLayerRepair;
let analysisRequest: typeof AnalysisRequest;
let notebookAnalysis: typeof NotebookAnalysis;

const BOOK_TITLE = "Sách PDF";
const MANGLED = "ðộc giả ñã ñọc ñến ñây, ñể ñiều ñó ñược ñổi. ".repeat(4);
const REPAIRED = "Độc giả đã đọc đến đây, để điều đó được đổi. ".repeat(4);
const SPANISH = "Señor Peña vive ở Madrid.";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// A book as it was imported before the repair existed: the text layer's ñ and ð went into the pages, the canonical
// document, both chapters (title, file, hash), a lesson's source excerpt, and chapter 1 was analysed from that text.
// Page 3 came from OCR and legitimately quotes a Spanish name.
async function seedMangledBook(options: { analysisStatus?: string } = {}) {
  const id = `book-${Math.random().toString(36).slice(2)}`;
  const { book, extraction } = await repo.createPdfBookWithExtraction(
    {
      id,
      title: BOOK_TITLE,
      sourceFilePath: `books/${id}/original.pdf`,
      sourceFileName: "sach.pdf",
      sourceHash: `hash-${id}`,
      sourceSizeBytes: 1,
    },
    3_000_000,
  );
  const texts = [`Chương 1 / Bầy thú ñiện tử\n${MANGLED}`, `Chương 2 / ðông Nam Á\n${MANGLED}`, SPANISH];
  await db.prisma.extractionPage.createMany({
    data: texts.map((text, index) => ({
      extractionId: extraction.id,
      pageNumber: index + 1,
      status: "EXTRACTED",
      method: index === 2 ? "OCR" : "TEXT",
      text,
    })),
  });
  await db.prisma.bookExtraction.update({
    where: { id: extraction.id },
    data: { pageCount: 3, status: "ASSEMBLING" },
  });
  const document = await canonical.assembleExtractionDocument(extraction.id);
  const [first, second] = document.pageOffsets;
  if (!first || !second) throw new Error("expected page offsets");
  await chaptersService.createChaptersFromRanges({
    extractionId: extraction.id,
    bookId: book.id,
    markdown: document.markdown,
    from: "ASSEMBLING",
    ranges: [
      { title: "Chương 1 / Bầy thú ñiện tử", start: first.start, end: second.start },
      { title: "Chương 2 / ðông Nam Á", start: second.start, end: document.markdown.length },
    ],
  });

  const [one] = await db.prisma.chapter.findMany({ where: { bookId: book.id }, orderBy: { order: "asc" } });
  if (!one) throw new Error("expected chapters");
  await db.prisma.chapter.update({
    where: { id: one.id },
    data: {
      analysisStatus: options.analysisStatus ?? "ANALYZED",
      analysisPromptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
    },
  });
  await db.prisma.aiRun.create({
    data: {
      mode: "notebooklm",
      promptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
      inputHash: notebookAnalysis.notebookAnalysisInputHash({
        contentHash: one.contentHash,
        chapterTitle: one.title,
        bookTitle: BOOK_TITLE,
      }),
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
  await db.prisma.lesson.create({
    data: {
      bookId: book.id,
      title: "Chấp nhận thực tế",
      summary: "s",
      principle: "p",
      realLifeScenario: "r",
      commonMistake: "m",
      betterApproach: "b",
      actionableStep: "a",
      origin: "AI",
      sources: {
        create: [
          { chapterId: one.id, sourceExcerpt: "ñã ñọc ñến ñây", sourceLocator: "offset:12" },
          { chapterId: one.id, sourceExcerpt: null, sourceLocator: "offset:90" },
        ],
      },
    },
  });
  return { bookId: book.id, extractionId: extraction.id, book: { id: book.id, title: BOOK_TITLE } };
}

const chapters = (bookId: string) => db.prisma.chapter.findMany({ where: { bookId }, orderBy: { order: "asc" } });
const pageTexts = async (extractionId: string) =>
  (await db.prisma.extractionPage.findMany({ where: { extractionId }, orderBy: { pageNumber: "asc" } })).map(
    (page) => page.text,
  );
const readData = (relativePath: string) => fs.readFileSync(path.join(env.dataDir, relativePath), "utf8");

async function readyPlan(book: { id: string; title: string }) {
  const outcome = await repair.planTextLayerRepair(book);
  if (outcome.kind !== "READY") throw new Error(`expected a plan, got ${outcome.kind}`);
  return outcome.plan;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  repo = await import("@/features/extraction/repositories/extraction.repository");
  canonical = await import("@/features/extraction/services/canonical-document.service");
  chaptersService = await import("@/features/extraction/services/extraction-chapters.service");
  repair = await import("@/features/extraction/services/text-layer-repair.service");
  analysisRequest = await import("@/features/chapters/services/analysis-request.service");
  notebookAnalysis = await import("@/features/chapters/services/notebook-chapter-analysis.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  await db.prisma.aiRun.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("planTextLayerRepair", () => {
  it("lists what would change and changes nothing", async () => {
    const { book, extractionId } = await seedMangledBook();
    const before = await pageTexts(extractionId);

    const plan = await readyPlan(book);

    expect(plan.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(plan.chapters.map((chapter) => [chapter.order, chapter.title])).toEqual([
      [1, "Chương 1 / Bầy thú điện tử"],
      [2, "Chương 2 / Đông Nam Á"],
    ]);
    expect(plan.renamedChapters).toBe(2);
    expect(plan.excerpts).toEqual([expect.objectContaining({ sourceExcerpt: "đã đọc đến đây" })]);
    expect(plan.analyses).toHaveLength(1);
    expect(plan.skippedChapters).toEqual([]);
    expect(await pageTexts(extractionId)).toEqual(before);
  });

  it("has nothing to do for a book whose text layer was read correctly", async () => {
    const { book, extractionId } = await seedMangledBook();
    await db.prisma.extractionPage.updateMany({ where: { extractionId, method: "TEXT" }, data: { text: REPAIRED } });

    expect(await repair.planTextLayerRepair(book)).toMatchObject({ kind: "NOT_NEEDED" });
  });

  it("waits while a chapter is being analysed, so the analysis never reads two versions of its text", async () => {
    const { book } = await seedMangledBook({ analysisStatus: "ANALYZING" });

    expect(await repair.planTextLayerRepair(book)).toEqual({
      kind: "BLOCKED",
      reason: "Chương 1 đang được phân tích; chờ xong rồi chạy lại.",
    });
  });

  it("refuses when the canonical file no longer matches the stored pages", async () => {
    const { book, bookId, extractionId } = await seedMangledBook();
    const extraction = await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } });
    fs.writeFileSync(path.join(env.dataDir, extraction.canonicalPath ?? ""), `${MANGLED} đã sửa tay`);

    expect(await repair.planTextLayerRepair(book)).toMatchObject({ kind: "BLOCKED" });
    expect((await chapters(bookId))[0]?.title).toBe("Chương 1 / Bầy thú ñiện tử");
  });

  it("leaves a chapter alone whose file no longer matches what was extracted", async () => {
    const { book, bookId } = await seedMangledBook();
    const [, second] = await chapters(bookId);
    await db.prisma.chapter.update({ where: { id: second?.id ?? "" }, data: { contentHash: "edited-by-hand" } });

    const plan = await readyPlan(book);

    expect(plan.chapters.map((chapter) => chapter.order)).toEqual([1]);
    expect(plan.skippedChapters).toEqual([{ order: 2, reason: "Nội dung chương không còn khớp bản trích xuất." }]);
  });
});

describe("applyTextLayerRepair", () => {
  it("repairs pages, canonical document, chapters and excerpts, and keeps the offsets", async () => {
    const { book, bookId, extractionId } = await seedMangledBook();
    const offsets = (await chapters(bookId)).map((chapter) => [chapter.sourceStartOffset, chapter.sourceEndOffset]);
    const plan = await readyPlan(book);

    await repair.applyTextLayerRepair(plan);

    expect(await pageTexts(extractionId)).toEqual([
      `Chương 1 / Bầy thú điện tử\n${REPAIRED}`,
      `Chương 2 / Đông Nam Á\n${REPAIRED}`,
      SPANISH,
    ]);
    const extraction = await db.prisma.bookExtraction.findUniqueOrThrow({ where: { id: extractionId } });
    expect(readData(extraction.canonicalPath ?? "")).toBe(plan.markdown);
    expect(plan.markdown.match(/[ñðÑÐ]/gu)).toHaveLength(SPANISH.match(/ñ/gu)?.length ?? 0);

    const after = await chapters(bookId);
    expect(after.map((chapter) => chapter.title)).toEqual(["Chương 1 / Bầy thú điện tử", "Chương 2 / Đông Nam Á"]);
    expect(after.map((chapter) => [chapter.sourceStartOffset, chapter.sourceEndOffset])).toEqual(offsets);
    for (const chapter of after) {
      const content = readData(chapter.contentPath ?? "").trim();
      expect(chapter.contentHash).toBe(sha256(content));
      expect(content).not.toContain("ð");
    }
    expect(readData(after[1]?.contentPath ?? "")).toContain(SPANISH);

    const sources = await db.prisma.lessonSource.findMany({ orderBy: { sourceLocator: "asc" } });
    expect(sources.map((source) => [source.sourceExcerpt, source.sourceLocator])).toEqual([
      ["đã đọc đến đây", "offset:12"],
      [null, "offset:90"],
    ]);
  });

  it("keeps an analysed chapter up to date instead of offering a second analysis", async () => {
    const { book, bookId } = await seedMangledBook();
    const [analysed] = await chapters(bookId);
    if (!analysed) throw new Error("expected a chapter");
    expect(await analysisRequest.isUpToDate(analysed, BOOK_TITLE)).toBe(true);

    await repair.applyTextLayerRepair(await readyPlan(book));

    const [repaired] = await chapters(bookId);
    if (!repaired) throw new Error("expected a chapter");
    expect(repaired.contentHash).not.toBe(analysed.contentHash);
    expect(await analysisRequest.isUpToDate(repaired, BOOK_TITLE)).toBe(true);
    expect(await db.prisma.aiRun.count({ where: { status: "COMPLETED" } })).toBe(2);
  });

  it("keeps a copy of the database and of the files it replaced", async () => {
    const { book, bookId } = await seedMangledBook();
    const [one] = await chapters(bookId);
    const plan = await readyPlan(book);

    const { backupDir } = await repair.applyTextLayerRepair(plan);

    expect(fs.statSync(path.join(backupDir, "studio.db")).size).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(backupDir, one?.contentPath ?? ""), "utf8")).toContain("ñiện tử");
    expect(fs.readFileSync(path.join(backupDir, plan.canonicalPath), "utf8")).toContain("ðông Nam Á");
  });

  it("has nothing left to do when asked again", async () => {
    const { book } = await seedMangledBook();
    await repair.applyTextLayerRepair(await readyPlan(book));

    expect(await repair.planTextLayerRepair(book)).toMatchObject({ kind: "NOT_NEEDED" });
  });
});
