import type { ChapterOutline } from "../domain/chapter-outline";
import type { ProposedChapter } from "../domain/chapter-detection";

export interface ChapterDetectionInput {
  extractionId: string;
  book: { id: string; title: string };
  outline: ChapterOutline;
  pageCount: number;
}

// Proposes where chapters start when the local parser found none. Proposals are checked against the text before use.
export interface ChapterDetector {
  detect(input: ChapterDetectionInput, signal?: AbortSignal): Promise<ProposedChapter[]>;
}
