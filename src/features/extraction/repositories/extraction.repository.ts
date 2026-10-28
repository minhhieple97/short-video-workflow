import type { Book, BookExtraction } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

interface NewPdfBook {
  id: string;
  title: string;
  sourceFilePath: string;
  sourceFileName: string;
  sourceHash: string;
  sourceSizeBytes: number;
}

// The book and its first extraction run are created together: a PDF book without a run would never be processed.
export function createPdfBookWithExtraction(
  book: NewPdfBook,
  costCeilingMicroUsd: number,
): Promise<{ book: Book; extraction: BookExtraction }> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.book.create({
      data: { ...book, sourceFormat: "pdf", language: "vi", status: "ACTIVE" },
    });
    const extraction = await tx.bookExtraction.create({
      data: { bookId: created.id, status: "QUEUED", sourceHash: book.sourceHash, costCeilingMicroUsd },
    });
    return { book: created, extraction };
  });
}

export function findExtraction(extractionId: string): Promise<BookExtraction | null> {
  return prisma.bookExtraction.findUnique({ where: { id: extractionId } });
}

export async function setCanonicalPath(extractionId: string, canonicalPath: string): Promise<void> {
  await prisma.bookExtraction.update({ where: { id: extractionId }, data: { canonicalPath } });
}

export function findExtractionWithBook(extractionId: string) {
  return prisma.bookExtraction.findUnique({
    where: { id: extractionId },
    include: { book: { select: { id: true, sourceFilePath: true, sourceFormat: true } } },
  });
}

// Moves the run on only from a status it is expected to be in, so a stale step cannot pull it back.
export async function moveExtractionStatus(
  extractionId: string,
  from: readonly string[],
  data: {
    status: string;
    pageCount?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: Date | null;
  },
): Promise<boolean> {
  const { count } = await prisma.bookExtraction.updateMany({
    where: { id: extractionId, status: { in: [...from] } },
    data,
  });
  return count > 0;
}
