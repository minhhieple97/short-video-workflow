import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assembleCanonicalMarkdown } from "@/features/extraction/domain/canonical-document";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import {
  SOURCE_CONTEXT_CHARS,
  SOURCE_PACK_MAX_CHARS,
  sourceReferencesProblem,
} from "@/features/videos/domain/script-source-pack";
import type * as DbClient from "@/server/db/client";
import type * as SourcePack from "@/features/videos/services/script-source-pack.service";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let pack: typeof SourcePack;
let bookId: string;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  pack = await import("@/features/videos/services/script-source-pack.service");
}, 60_000);

beforeEach(async () => {
  await db.prisma.book.deleteMany();
  bookId = await addBook("md");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

async function addBook(sourceFormat: "md" | "pdf"): Promise<string> {
  const book = await db.prisma.book.create({
    data: {
      title: "Sách",
      sourceFilePath: `books/x/original.${sourceFormat}`,
      sourceFileName: `x.${sourceFormat}`,
      sourceHash: `hash-${Math.random()}`,
      sourceFormat,
      sourceSizeBytes: 1,
      status: "ACTIVE",
    },
  });
  return book.id;
}

async function addChapter(
  forBook: string,
  order: number,
  content: string,
  extra: { sourceStartOffset?: number; sourceEndOffset?: number } = {},
): Promise<string> {
  const chapter = await db.prisma.chapter.create({
    data: {
      bookId: forBook,
      order,
      title: `Chương ${order}`,
      contentHash: "c",
      analysisStatus: "ANALYZED",
      content,
      ...extra,
    },
  });
  return chapter.id;
}

const lesson = (lessonId: string, sources: { chapterId: string; excerpt: string | null }[]): LessonSnapshot => ({
  lessonId,
  title: `Bài ${lessonId}`,
  summary: "s",
  principle: "p",
  realLifeScenario: "r",
  commonMistake: "m",
  betterApproach: "b",
  actionableStep: "a",
  contentHash: null,
  sources: sources.map((source) => ({ ...source, chapterTitle: "Chương" })),
  capturedAt: "2026-10-31T00:00:00.000Z",
});

// Distinct filler per call, so a chapter never repeats the sentence a lesson quotes; exactly `length` characters long.
function filler(label: string, length: number): string {
  let text = "";
  for (let index = 0; text.length < length; index += 1) text += `${label}${index} `;
  return text.slice(0, length).trim();
}
const textOf = (sources: { text: string }[]) => sources.reduce((total, source) => total + source.text.length, 0);

describe("a script source pack from local chapters", () => {
  it("merges the context of two lessons that quote near each other and keeps both lessons on it", async () => {
    const first = "Quyền chủ động xuất bản không thay thế việc tìm đúng người đọc.";
    const second = "Một thử nghiệm nhỏ cho thấy phản hồi trước khi đầu tư thêm công sức.";
    const chapterId = await addChapter(
      bookId,
      1,
      `${filler("đầu", 3000)} ${first} ${filler("giữa", 500)} ${second} ${filler("cuối", 3000)}`,
    );

    const result = await pack.buildScriptSourcePack(bookId, [
      lesson("a", [{ chapterId, excerpt: first }]),
      lesson("b", [{ chapterId, excerpt: second }]),
    ]);

    expect(result.sources).toHaveLength(1);
    const [source] = result.sources;
    expect(source?.lessonIds.sort()).toEqual(["a", "b"]);
    expect(source?.text).toContain(first);
    expect(source?.text).toContain(second);
    expect(source?.excerpt).toBe(`${first}\n${second}`);
    expect(source?.page).toBeNull();
    expect(source?.endPage).toBeNull();
    expect(source?.pages).toEqual([{ page: null, start: 0, end: source?.text.length }]);
    expect(source?.text.length).toBeLessThanOrEqual(first.length + 500 + second.length + 2 * SOURCE_CONTEXT_CHARS + 60);
    expect(source?.chapterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source?.id).toMatch(/^source-[a-f0-9]{20}$/);
  });

  it("keeps each chapter's passage apart and in a stable order", async () => {
    const one = "Hành động đầu tiên là viết ra điều cần thử trong ngày hôm nay.";
    const two = "Kết quả chỉ đáng tin khi so với một mốc đã ghi lại từ trước đó.";
    const chapterOne = await addChapter(bookId, 1, `${filler("a", 500)} ${one} ${filler("b", 500)}`);
    const chapterTwo = await addChapter(bookId, 2, `${filler("c", 500)} ${two} ${filler("d", 500)}`);

    const lessons = [
      lesson("a", [{ chapterId: chapterOne, excerpt: one }]),
      lesson("b", [{ chapterId: chapterTwo, excerpt: two }]),
    ];
    const first = await pack.buildScriptSourcePack(bookId, lessons);
    const again = await pack.buildScriptSourcePack(bookId, [...lessons].reverse());

    expect(first.sources.map((source) => source.chapterId).sort()).toEqual([chapterOne, chapterTwo].sort());
    expect(first.sources.every((source) => source.lessonIds.length === 1)).toBe(true);
    expect(again).toEqual(first);
  });

  it("finds a quotation across line breaks and returns the book's own wording", async () => {
    const chapterId = await addChapter(
      bookId,
      1,
      `${filler("x", 300)}\nQuyền chủ động xuất bản\nkhông thay thế việc\ttìm đúng người đọc.\n${filler("y", 300)}`,
    );

    const result = await pack.buildScriptSourcePack(bookId, [
      lesson("a", [{ chapterId, excerpt: "Quyền chủ động xuất bản không thay thế việc tìm đúng người đọc." }]),
    ]);

    expect(result.sources[0]?.excerpt).toBe("Quyền chủ động xuất bản\nkhông thay thế việc\ttìm đúng người đọc.");
    expect(result.sources[0]?.text).toContain(result.sources[0]?.excerpt);
  });

  it("reads decomposed Vietnamese letters as the composed ones the model will quote", async () => {
    const composed = "Chủ động kết nối với người học là điều kiện của kết quả.";
    const chapterId = await addChapter(
      bookId,
      1,
      `${filler("p", 200)} ${composed.normalize("NFD")} ${filler("q", 200)}`,
    );

    const result = await pack.buildScriptSourcePack(bookId, [lesson("a", [{ chapterId, excerpt: composed }])]);

    expect(result.sources[0]?.text).toContain(composed);
    expect(result.sources[0]?.text).toBe(result.sources[0]?.text.normalize("NFC"));
  });

  it("makes the context smaller before it gives up a lesson, and never cuts an excerpt", async () => {
    const lessons: LessonSnapshot[] = [];
    const excerpts: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const excerpt = `Đoạn trích số ${index} ${filler(`e${index}`, 3000)}`;
      excerpts.push(excerpt);
      const chapterId = await addChapter(
        bookId,
        index + 1,
        `${filler(`t${index}`, 4000)} ${excerpt} ${filler(`u${index}`, 4000)}`,
      );
      lessons.push(lesson(`l${index}`, [{ chapterId, excerpt }]));
    }

    const result = await pack.buildScriptSourcePack(bookId, lessons);

    expect(textOf(result.sources)).toBeLessThanOrEqual(SOURCE_PACK_MAX_CHARS);
    expect(textOf(result.sources)).toBeGreaterThan(excerpts.join("").length);
    expect(new Set(result.sources.flatMap((source) => source.lessonIds)).size).toBe(10);
    for (const excerpt of excerpts) expect(result.sources.some((source) => source.text.includes(excerpt))).toBe(true);
    for (const source of result.sources) expect(source.text.length).toBeGreaterThan(source.excerpt.length);
  });

  it("fails with a clear code instead of dropping a lesson when the excerpts alone are too long", async () => {
    const lessons: LessonSnapshot[] = [];
    for (let index = 0; index < 14; index += 1) {
      const excerpt = `Đoạn trích số ${index} ${filler(`e${index}`, 3000)}`;
      const chapterId = await addChapter(bookId, index + 1, excerpt);
      lessons.push(lesson(`l${index}`, [{ chapterId, excerpt }]));
    }

    await expect(pack.buildScriptSourcePack(bookId, lessons)).rejects.toMatchObject({
      code: "SCRIPT_SOURCE_TOO_LARGE",
    });
  });

  it("refuses a chapter of another book, a missing excerpt and an excerpt the chapter no longer contains", async () => {
    const own = await addChapter(bookId, 1, "Nội dung chương của chính cuốn sách này, đủ dài để tìm.");
    const other = await addChapter(await addBook("md"), 1, "Nội dung chương của một cuốn sách khác hẳn.");

    await expect(
      pack.buildScriptSourcePack(bookId, [
        lesson("a", [{ chapterId: other, excerpt: "Nội dung chương của một cuốn" }]),
      ]),
    ).rejects.toMatchObject({ code: "SCRIPT_SOURCE_BOOK_MISMATCH" });
    await expect(
      pack.buildScriptSourcePack(bookId, [lesson("a", [{ chapterId: own, excerpt: "   " }])]),
    ).rejects.toMatchObject({ code: "SCRIPT_SOURCE_MISSING" });
    await expect(pack.buildScriptSourcePack(bookId, [lesson("a", [])])).rejects.toMatchObject({
      code: "SCRIPT_SOURCE_MISSING",
    });
    await expect(
      pack.buildScriptSourcePack(bookId, [
        lesson("a", [{ chapterId: own, excerpt: "Câu này không hề có trong chương." }]),
      ]),
    ).rejects.toMatchObject({ code: "SCRIPT_SOURCE_EXCERPT_MISMATCH" });
  });

  it("names the PDF page a quotation is on, not the page its context starts on", async () => {
    const pdfBook = await addBook("pdf");
    const quoted = "Hành động nhỏ lặp lại mỗi ngày tạo ra thay đổi có thể đo được.";
    const pages = [
      { pageNumber: 1, text: `${filler("một", 600)} cuối trang một.` },
      { pageNumber: 2, text: `${quoted} ${filler("hai", 600)}` },
    ];
    const document = assembleCanonicalMarkdown(pages, 2);
    const chapterId = await addChapter(pdfBook, 1, "", {
      sourceStartOffset: 0,
      sourceEndOffset: document.markdown.length,
    });
    const extraction = await db.prisma.bookExtraction.create({
      data: { bookId: pdfBook, status: "COMPLETED", sourceHash: "pdf", pageCount: 2, completedAt: new Date() },
    });
    await db.prisma.extractionPage.createMany({
      data: pages.map((page) => ({
        extractionId: extraction.id,
        pageNumber: page.pageNumber,
        status: "EXTRACTED",
        method: "TEXT",
        text: page.text,
      })),
    });

    const result = await pack.buildScriptSourcePack(pdfBook, [lesson("a", [{ chapterId, excerpt: quoted }])]);

    const [source] = result.sources;
    expect(source?.page).toBe(1);
    expect(source?.endPage).toBe(2);
    expect(source?.pages?.map((span) => span.page).filter((page) => page !== null)).toEqual([1, 2]);
    expect(sourceReferencesProblem(result, [{ sourceId: source?.id ?? "", page: 2, text: quoted }])).toBeNull();
    expect(sourceReferencesProblem(result, [{ sourceId: source?.id ?? "", page: 1, text: quoted }])).toContain("Trang");
  });
});
