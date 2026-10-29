import "server-only";

import { chapterLabel, toChapterAnalysisStatus } from "../domain/analysis-status";
import { countAnalysisProgress, type BookAnalysisOverview } from "../domain/analysis-progress";
import { listChaptersByBook } from "../repositories/chapter.repository";
import { isUpToDate } from "./analysis-request.service";

const PENDING = new Set(["QUEUED", "ANALYZING", "WAITING_FOR_CLI"]);

// Counts the book's chapters by analysis state and works out what "analyse every chapter" would queue, with the same
// up-to-date check the request itself uses, so the button never promises more or less than a click does.
export async function getBookAnalysisOverview(bookId: string, bookTitle: string): Promise<BookAnalysisOverview> {
  const chapters = await listChaptersByBook(bookId);
  const progress = countAnalysisProgress(chapters.map((chapter) => toChapterAnalysisStatus(chapter.analysisStatus)));

  let needsAnalysis = 0;
  let outdated = 0;
  for (const chapter of chapters) {
    if (PENDING.has(chapter.analysisStatus)) continue;
    if (await isUpToDate(chapter, bookTitle)) continue;
    needsAnalysis += 1;
    if (chapter.analysisStatus === "ANALYZED") outdated += 1;
  }
  const current = chapters.find((chapter) => chapter.analysisStatus === "ANALYZING");
  return {
    ...progress,
    needsAnalysis,
    outdated,
    currentChapter: current ? chapterLabel(current.order, current.title) : null,
  };
}
