import type { ChapterAnalysisInput, ChapterAnalysisOutput } from "./contracts/chapter-analysis";

export type AiTaskResult<TOutput> =
  { status: "completed"; output: TOutput } | { status: "waiting_for_cli"; taskDir: string };

export interface AiTaskContext {
  jobRecordId: string;
}

export interface AiProvider {
  readonly mode: "mock" | "cli-task";
  analyzeChapter(input: ChapterAnalysisInput, context: AiTaskContext): Promise<AiTaskResult<ChapterAnalysisOutput>>;
}
