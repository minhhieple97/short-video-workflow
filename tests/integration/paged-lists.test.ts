import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as BookImportService from "@/features/books/services/book-import.service";
import type * as BookService from "@/features/books/services/book.service";
import type * as ChapterAnalysisService from "@/features/chapters/services/chapter-analysis.service";
import type * as ChapterService from "@/features/chapters/services/chapter.service";
import type * as LessonService from "@/features/lessons/services/lesson.service";
import type * as DbClient from "@/server/db/client";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let importService: typeof BookImportService;
let books: typeof BookService;
let analysis: typeof ChapterAnalysisService;
let chapters: typeof ChapterService;
let lessons: typeof LessonService;
let db: typeof DbClient;
let bookId: string;
let chapterIds: string[];

async function importBook(input: Parameters<typeof BookImportService.previewImport>[0], title: string) {
  const preview = await importService.previewImport(input);
  const { bookId: id } = await importService.confirmImport({
    importId: preview.importId,
    title,
    author: null,
    description: null,
    allowDuplicate: true,
    chapters: preview.sections.filter((s) => s.include).map(({ title: t, start, end }) => ({ title: t, start, end })),
  });
  return id;
}

beforeAll(async () => {
  env = setupTestEnvironment();
  importService = await import("@/features/books/services/book-import.service");
  books = await import("@/features/books/services/book.service");
  analysis = await import("@/features/chapters/services/chapter-analysis.service");
  chapters = await import("@/features/chapters/services/chapter.service");
  lessons = await import("@/features/lessons/services/lesson.service");
  db = await import("@/server/db/client");

  bookId = await importBook(
    {
      kind: "file",
      fileName: "sample.md",
      mimeType: "text/markdown",
      bytes: new Uint8Array(fs.readFileSync(SAMPLE_BOOK_PATH)),
    },
    "Sách mẫu",
  );
  chapterIds = (await chapters.listChapters(bookId)).map((chapter) => chapter.id);
  for (const chapterId of chapterIds.slice(0, 2)) {
    await analysis.runChapterAnalysis({ chapterId, jobRecordId: null, force: false });
  }
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("chapters in pages", () => {
  it("serves chapters in book order, a page at a time, with the lesson counts of that page", async () => {
    const first = await chapters.listChaptersPage(bookId, { page: 1, pageSize: 2 });
    const second = await chapters.listChaptersPage(bookId, { page: 2, pageSize: 2 });

    expect(first).toMatchObject({ total: chapterIds.length, page: 1, pageSize: 2 });
    expect(first.pageCount).toBe(Math.ceil(chapterIds.length / 2));
    expect(first.items.map((chapter) => chapter.id)).toEqual(chapterIds.slice(0, 2));
    expect(second.items.map((chapter) => chapter.id)).toEqual(chapterIds.slice(2, 4));
    expect(first.items.map((chapter) => chapter.lessonCount)).toEqual([2, 2]);
  });

  it("lists every chapter's number and title for the pickers", async () => {
    const refs = await chapters.listChapterRefsOfBook(bookId);

    expect(refs.map((ref) => ref.id)).toEqual(chapterIds);
    expect(refs.map((ref) => ref.order)).toEqual(refs.map((_, index) => index + 1));
  });
});

describe("lessons in pages", () => {
  it("cuts the filtered list into pages that together hold every lesson once", async () => {
    const everything = await lessons.listLessons(bookId);
    expect(everything).toHaveLength(4);

    const first = await lessons.listLessonsPage(bookId, {}, { page: 1, pageSize: 3 });
    const second = await lessons.listLessonsPage(bookId, {}, { page: 2, pageSize: 3 });

    expect(first).toMatchObject({ total: 4, pageCount: 2, page: 1 });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((lesson) => lesson.id)).toEqual(everything.map((lesson) => lesson.id));
  });

  it("counts the filter, not the whole book, and serves the last page for a page past the end", async () => {
    const filtered = await lessons.listLessonsPage(bookId, { chapterId: chapterIds[0] }, { page: 9, pageSize: 1 });

    expect(filtered).toMatchObject({ total: 2, page: 2, pageCount: 2 });
    expect(filtered.items.map((lesson) => lesson.chapters.map((chapter) => chapter.id))).toEqual([[chapterIds[0]]]);
  });
});

describe("changing the status of several lessons", () => {
  it("approves the chosen drafts and leaves the others alone", async () => {
    const [a, b, c] = await lessons.listLessons(bookId);

    expect(await lessons.changeLessonStatuses(bookId, [a!.id, b!.id], "APPROVED")).toEqual({
      changed: 2,
      unchanged: 0,
      blocked: 0,
    });

    expect((await lessons.getLesson(a!.id)).status).toBe("APPROVED");
    expect((await lessons.getLesson(b!.id)).status).toBe("APPROVED");
    expect((await lessons.getLesson(c!.id)).status).toBe("DRAFT");
  });

  it("counts lessons already there and lessons that cannot move, instead of failing the whole request", async () => {
    const [approved, , draft, other] = await lessons.listLessons(bookId);
    await lessons.changeLessonStatuses(bookId, [other!.id], "ARCHIVED");

    // approved: already APPROVED · draft: moves · other: ARCHIVED cannot go straight to APPROVED
    const result = await lessons.changeLessonStatuses(bookId, [approved!.id, draft!.id, other!.id], "APPROVED");

    expect(result).toEqual({ changed: 1, unchanged: 1, blocked: 1 });
    expect((await lessons.getLesson(draft!.id)).status).toBe("APPROVED");
    expect((await lessons.getLesson(other!.id)).status).toBe("ARCHIVED");
  });

  it("rejects, then brings back, several lessons in one go", async () => {
    const ids = (await lessons.listLessons(bookId)).map((lesson) => lesson.id);

    expect(await lessons.changeLessonStatuses(bookId, ids, "ARCHIVED")).toMatchObject({ changed: 3, unchanged: 1 });
    expect(await lessons.changeLessonStatuses(bookId, ids, "DRAFT")).toMatchObject({ changed: 4 });
    expect((await lessons.listLessons(bookId)).map((lesson) => lesson.status)).toEqual(Array(4).fill("DRAFT"));
  });

  it("refuses ids that are not lessons of this book, and changes nothing", async () => {
    const otherBook = await importBook(
      { kind: "text", text: "Chương 1: Khác\n\nNội dung.", format: "txt" },
      "Sách khác",
    );
    await analysis.runChapterAnalysis({
      chapterId: (await chapters.listChapters(otherBook))[0]!.id,
      jobRecordId: null,
      force: false,
    });
    const [foreign] = await lessons.listLessons(otherBook);
    const [mine] = await lessons.listLessons(bookId);

    await expect(lessons.changeLessonStatuses(bookId, [mine!.id, foreign!.id], "APPROVED")).rejects.toMatchObject({
      code: "LESSON_NOT_FOUND",
      httpStatus: 404,
    });
    await expect(lessons.changeLessonStatuses(bookId, ["missing"], "APPROVED")).rejects.toMatchObject({
      httpStatus: 404,
    });
    expect((await lessons.getLesson(mine!.id)).status).toBe("DRAFT");
    expect((await lessons.getLesson(foreign!.id)).status).toBe("DRAFT");
  });
});

describe("books in pages", () => {
  it("filters by the search first and pages what is left", async () => {
    await importBook({ kind: "text", text: "Chương 1: A\n\nNội dung A.", format: "txt" }, "Thói quen nhỏ");
    await importBook({ kind: "text", text: "Chương 1: B\n\nNội dung B.", format: "txt" }, "Thói quen lớn");

    const all = await books.listBooksPage(undefined, { page: 1, pageSize: 2 });
    const habits = await books.listBooksPage("thoi quen", { page: 1, pageSize: 1 });
    const later = await books.listBooksPage("thoi quen", { page: 2, pageSize: 1 });

    expect(all.total).toBeGreaterThanOrEqual(4);
    expect(all.items).toHaveLength(2);
    expect(habits).toMatchObject({ total: 2, pageCount: 2, page: 1 });
    expect(habits.items[0]?.title).toBe("Thói quen lớn");
    expect(later.items.map((book) => book.title)).toEqual(["Thói quen nhỏ"]);
  });
});
