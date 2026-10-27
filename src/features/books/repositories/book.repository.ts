import type { Book } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

const ACTIVE = { deletedAt: null } as const;

const SUMMARY_COUNTS = {
  _count: {
    select: {
      chapters: true,
      videos: true,
      lessons: { where: { status: { not: "ARCHIVED" as const } } },
    },
  },
};

export type BookWithCounts = Book & { _count: { chapters: number; videos: number; lessons: number } };

export interface NewChapterRecord {
  id: string;
  order: number;
  title: string;
  contentPath: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  contentHash: string;
}

export interface NewBookRecord {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  sourceFilePath: string;
  sourceFileName: string;
  sourceHash: string;
  sourceFormat: string;
  sourceSizeBytes: number;
}

export function listActiveBooks(): Promise<BookWithCounts[]> {
  return prisma.book.findMany({ where: ACTIVE, orderBy: { createdAt: "desc" }, include: SUMMARY_COUNTS });
}

export function findActiveBookById(id: string): Promise<BookWithCounts | null> {
  return prisma.book.findFirst({ where: { id, ...ACTIVE }, include: SUMMARY_COUNTS });
}

export function findActiveBookBySourceHash(sourceHash: string): Promise<Book | null> {
  return prisma.book.findFirst({ where: { sourceHash, ...ACTIVE }, orderBy: { createdAt: "asc" } });
}

export function createBookWithChapters(book: NewBookRecord, chapters: readonly NewChapterRecord[]): Promise<Book> {
  return prisma.book.create({
    data: {
      ...book,
      language: "vi",
      status: "ACTIVE",
      chapters: { create: chapters.map((chapter) => ({ ...chapter, analysisStatus: "NOT_ANALYZED" })) },
    },
  });
}

export function updateBookMetadata(
  id: string,
  data: { title: string; author: string | null; description: string | null },
): Promise<Book> {
  return prisma.book.update({ where: { id }, data });
}

export function softDeleteBook(id: string): Promise<Book> {
  return prisma.book.update({ where: { id }, data: { deletedAt: new Date(), status: "DELETED" } });
}
