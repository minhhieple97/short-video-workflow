import { prisma } from "@/server/db/client";

export function listPdfBooks(): Promise<{ id: string; title: string }[]> {
  return prisma.book.findMany({
    where: { sourceFormat: "pdf", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });
}

export function listExtractionPagesWithMethod(extractionId: string) {
  return prisma.extractionPage.findMany({
    where: { extractionId },
    orderBy: { pageNumber: "asc" },
    select: { pageNumber: true, method: true, text: true },
  });
}

export function listChaptersForRepair(bookId: string) {
  return prisma.chapter.findMany({
    where: { bookId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      contentPath: true,
      contentHash: true,
      sourceStartOffset: true,
      sourceEndOffset: true,
      analysisStatus: true,
    },
  });
}

export function listLessonSourceExcerpts(bookId: string): Promise<{ id: string; sourceExcerpt: string | null }[]> {
  return prisma.lessonSource.findMany({
    where: { lesson: { bookId }, sourceExcerpt: { not: null } },
    select: { id: true, sourceExcerpt: true },
  });
}

export function findCompletedAiRuns(inputHashes: readonly string[]) {
  return prisma.aiRun.findMany({
    where: { inputHash: { in: [...inputHashes] }, status: "COMPLETED" },
    select: { inputHash: true, mode: true, promptVersion: true, completedAt: true },
  });
}

export interface TextLayerRepairWrites {
  pages: { extractionId: string; pageNumber: number; text: string }[];
  chapters: { id: string; title: string; contentHash: string }[];
  excerpts: { id: string; sourceExcerpt: string }[];
  // Analyses that were done on the text before the repair, recorded again under the hash of the repaired text.
  analyses: { inputHash: string; mode: string; promptVersion: string; completedAt: Date | null }[];
}

export function writeTextLayerRepair(writes: TextLayerRepairWrites): Promise<void> {
  return prisma.$transaction(
    async (tx) => {
      for (const { extractionId, pageNumber, text } of writes.pages) {
        await tx.extractionPage.update({
          where: { extractionId_pageNumber: { extractionId, pageNumber } },
          data: { text },
        });
      }
      for (const { id, title, contentHash } of writes.chapters) {
        await tx.chapter.update({ where: { id }, data: { title, contentHash } });
      }
      for (const { id, sourceExcerpt } of writes.excerpts) {
        await tx.lessonSource.update({ where: { id }, data: { sourceExcerpt } });
      }
      for (const analysis of writes.analyses) {
        const recorded = await tx.aiRun.count({ where: { inputHash: analysis.inputHash, status: "COMPLETED" } });
        if (recorded === 0) await tx.aiRun.create({ data: { ...analysis, status: "COMPLETED" } });
      }
    },
    { timeout: 120_000 },
  );
}

// A consistent copy even while the web and the worker hold the file open.
export async function copyDatabaseTo(targetFile: string): Promise<void> {
  await prisma.$executeRaw`VACUUM INTO ${targetFile}`;
}
