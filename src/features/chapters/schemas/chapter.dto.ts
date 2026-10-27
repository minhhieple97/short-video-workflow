import type { ChapterAnalysisStatus } from "../domain/analysis-status";

export interface ChapterSummary {
  id: string;
  bookId: string;
  order: number;
  title: string;
  sourceLength: number;
  analysisStatus: ChapterAnalysisStatus;
  analyzedAt: string | null;
  lessonCount: number;
}

export interface ChapterDetail extends ChapterSummary {
  book: { id: string; title: string };
  contentHash: string;
  sourceStartOffset: number | null;
  sourceEndOffset: number | null;
  content: string;
}
