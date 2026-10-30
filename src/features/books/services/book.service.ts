import { toExtractionStatus } from "@/features/extraction/domain/extraction-status";
import { AppError, NotFoundError } from "@/shared/errors";
import { slicePage, type Page, type PageRequest } from "@/shared/pagination";
import { foldForSearch } from "@/shared/search";

import {
  findActiveBookById,
  listActiveBooks,
  softDeleteBook,
  updateBookMetadata,
  type BookWithCounts,
} from "../repositories/book.repository";
import type { BookSummary } from "../schemas/book.dto";
import type { UpdateBookInput } from "../schemas/book.schema";

function toExtractionSummary(extraction: { status: string; errorCode: string | null } | undefined) {
  return extraction ? { status: toExtractionStatus(extraction.status), hasError: extraction.errorCode !== null } : null;
}

function toBookSummary(book: BookWithCounts): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    sourceFileName: book.sourceFileName,
    sourceFormat: book.sourceFormat,
    extraction: toExtractionSummary(book.extractions[0]),
    chapterCount: book._count.chapters,
    lessonCount: book._count.lessons,
    videoCount: book._count.videos,
    createdAt: book.createdAt.toISOString(),
  };
}

export async function listBooks(query?: string): Promise<BookSummary[]> {
  const books = (await listActiveBooks()).map(toBookSummary);
  const needle = query ? foldForSearch(query) : "";
  if (!needle) return books;
  return books.filter((book) => foldForSearch(`${book.title} ${book.author ?? ""}`).includes(needle));
}

// The search folds diacritics in memory, so the filtered list is cut into pages here rather than in the query.
export async function listBooksPage(query: string | undefined, request: PageRequest): Promise<Page<BookSummary>> {
  return slicePage(await listBooks(query), request);
}

async function requireBook(id: string): Promise<BookWithCounts> {
  const book = await findActiveBookById(id);
  if (!book) throw new NotFoundError("BOOK_NOT_FOUND", "Không tìm thấy sách.");
  return book;
}

export async function getBook(id: string): Promise<BookSummary> {
  return toBookSummary(await requireBook(id));
}

export async function updateBook(id: string, input: UpdateBookInput): Promise<BookSummary> {
  await requireBook(id);
  await updateBookMetadata(id, input);
  return getBook(id);
}

// Books that already have videos cannot be deleted; otherwise the delete is soft and keeps every file on disk.
export async function deleteBook(id: string): Promise<void> {
  const book = await requireBook(id);
  if (book._count.videos > 0) {
    throw new AppError(
      "BOOK_HAS_VIDEOS",
      `Không thể xoá: sách đang có ${book._count.videos} video. Hãy xoá hoặc lưu trữ các video trước.`,
      409,
    );
  }
  await softDeleteBook(id);
}
