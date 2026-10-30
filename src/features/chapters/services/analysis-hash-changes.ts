import type { AiMode } from "@/server/ai/ai-provider";

import { analysisInputHash } from "./chapter-analysis.service";
import { notebookAnalysisInputHash } from "./notebook-chapter-analysis.service";

const CHAPTER_ANALYSIS_MODES: readonly AiMode[] = ["mock", "cli-task", "cli-auto"];

export interface AnalysisInput {
  contentHash: string;
  title: string;
}

// An analysis counts as done when a run is recorded under the hash of the chapter's text and title. When a repair changes
// either without changing what the chapter says, each hash a finished run could sit under (the NotebookLM catalogue, and
// the v1.1 analysis in every AI mode) pairs with the hash it takes afterwards.
export function analysisHashChanges(
  before: AnalysisInput,
  after: AnalysisInput,
  bookTitle: string,
): { from: string; to: string }[] {
  const notebook = (input: AnalysisInput) =>
    notebookAnalysisInputHash({ contentHash: input.contentHash, chapterTitle: input.title, bookTitle });
  const chapter = (input: AnalysisInput, mode: AiMode) =>
    analysisInputHash({ mode, contentHash: input.contentHash, chapterTitle: input.title, bookTitle });
  return [
    { from: notebook(before), to: notebook(after) },
    ...CHAPTER_ANALYSIS_MODES.map((mode) => ({ from: chapter(before, mode), to: chapter(after, mode) })),
  ];
}
