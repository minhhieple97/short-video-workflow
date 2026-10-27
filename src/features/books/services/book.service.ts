import { AppError, NotFoundError } from "@/shared/errors";
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

function toBookSummary(book: BookWithCounts): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    sourceFileName: book.sourceFileName,
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
