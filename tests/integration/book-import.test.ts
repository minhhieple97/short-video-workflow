import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as BookImportService from "@/features/books/services/book-import.service";
import type * as BookService from "@/features/books/services/book.service";
import type * as ChapterService from "@/features/chapters/services/chapter.service";
import type * as DbClient from "@/server/db/client";

import { SAMPLE_BOOK_PATH, setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

// Modules are imported after setupTestEnvironment() so they read the temporary database configuration.
let env: TestEnvironment;
let importService: typeof BookImportService;
let bookService: typeof BookService;
let chapterService: typeof ChapterService;
let db: typeof DbClient;

const SAMPLE_BYTES = new Uint8Array(fs.readFileSync(SAMPLE_BOOK_PATH));

async function previewSample() {
  return importService.previewImport({
    kind: "file",
    fileName: "../../atomic-habits-sample.md",
    mimeType: "text/markdown",
    bytes: SAMPLE_BYTES,
  });
}

function includedChapters(preview: Awaited<ReturnType<typeof previewSample>>) {
  return preview.sections.filter((section) => section.include).map(({ title, start, end }) => ({ title, start, end }));
}

beforeAll(async () => {
  env = setupTestEnvironment();
  importService = await import("@/features/books/services/book-import.service");
  bookService = await import("@/features/books/services/book.service");
  chapterService = await import("@/features/chapters/services/chapter.service");
  db = await import("@/server/db/client");
}, 60_000);

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("book import", () => {
  let bookId: string;

  it("imports the three-chapter sample with an edited title and keeps the original untouched", async () => {
    const preview = await previewSample();
    expect(preview.fileName).toBe("atomic-habits-sample.md");
    expect(preview.duplicateOf).toBeNull();

    const chapters = includedChapters(preview);
    expect(chapters).toHaveLength(3);
    chapters[0] = { ...chapters[0]!, title: "Chương 1: Thay đổi nhỏ, kết quả lớn" };

    ({ bookId } = await importService.confirmImport({
      importId: preview.importId,
      title: preview.suggestedTitle,
      author: "James Clear",
      description: null,
      allowDuplicate: false,
      chapters,
    }));

    const stored = await chapterService.listChapters(bookId);
    expect(stored.map((chapter) => [chapter.order, chapter.title])).toEqual([
      [1, "Chương 1: Thay đổi nhỏ, kết quả lớn"],
      [2, "Chương 2: Thiết kế môi trường cho thói quen tốt"],
      [3, "Chương 3: Làm cho thói quen dễ thực hiện"],
    ]);
    expect(stored.every((chapter) => chapter.analysisStatus === "NOT_ANALYZED")).toBe(true);

    const originalPath = path.join(env.dataDir, "books", bookId, "original.md");
    expect(new Uint8Array(fs.readFileSync(originalPath))).toEqual(SAMPLE_BYTES);
    expect(fs.statSync(originalPath).mode & 0o222).toBe(0);
    expect(fs.existsSync(path.join(env.dataDir, "imports", preview.importId))).toBe(false);

    const detail = await chapterService.getChapter(stored[1]!.id);
    expect(detail.content.startsWith("## Chương 2: Thiết kế môi trường")).toBe(true);
    expect(detail.content).toContain("### Gợi ý áp dụng");
    expect(detail.content).not.toContain("## Chương 3");
  });

  it("finds books by title or author regardless of diacritics", async () => {
    expect(await bookService.listBooks("atomic")).toHaveLength(1);
    expect(await bookService.listBooks("ban tom luoc minh hoa")).toHaveLength(1);
    expect(await bookService.listBooks("JAMES")).toHaveLength(1);
    expect(await bookService.listBooks("không có")).toHaveLength(0);
    expect((await bookService.getBook(bookId)).chapterCount).toBe(3);
  });

  it("warns about a duplicate on preview and refuses it on confirm unless explicitly allowed", async () => {
    const preview = await previewSample();
    expect(preview.duplicateOf?.id).toBe(bookId);

    const input = {
      importId: preview.importId,
      title: "Bản sao",
      author: null,
      description: null,
      allowDuplicate: false,
      chapters: includedChapters(preview),
    };
    await expect(importService.confirmImport(input)).rejects.toMatchObject({ code: "DUPLICATE_BOOK", httpStatus: 409 });

    const copy = await importService.confirmImport({ ...input, allowDuplicate: true });
    expect(copy.bookId).not.toBe(bookId);
  });

  it("imports pasted text and rejects unknown or replayed import sessions", async () => {
    const text =
      "Chương 1\n\n" + "Nội dung chương một khá dài. ".repeat(10) + "\n\nChương 2\n\n" + "Nội dung hai. ".repeat(12);
    const preview = await importService.previewImport({ kind: "text", text, format: "txt" });
    const confirmed = await importService.confirmImport({
      importId: preview.importId,
      title: "Văn bản dán",
      author: null,
      description: null,
      allowDuplicate: false,
      chapters: includedChapters(preview),
    });
    expect((await chapterService.listChapters(confirmed.bookId)).map((chapter) => chapter.title)).toEqual([
      "Chương 1",
      "Chương 2",
    ]);

    await expect(
      importService.confirmImport({
        importId: preview.importId,
        title: "Lặp lại",
        author: null,
        description: null,
        allowDuplicate: true,
        chapters: includedChapters(preview),
      }),
    ).rejects.toMatchObject({ code: "IMPORT_NOT_FOUND" });
  });

  it("soft-deletes a book without videos and blocks deleting a book that has videos", async () => {
    const [withVideo] = await bookService.listBooks("ban sao");
    await db.prisma.video.create({ data: { bookId: withVideo!.id, title: "Video thử" } });
    await expect(bookService.deleteBook(withVideo!.id)).rejects.toMatchObject({ code: "BOOK_HAS_VIDEOS" });

    await bookService.deleteBook(bookId);
    await expect(bookService.getBook(bookId)).rejects.toMatchObject({ code: "BOOK_NOT_FOUND" });
    expect(fs.existsSync(path.join(env.dataDir, "books", bookId, "original.md"))).toBe(true);
  });
});
