import type { ChapterAnalysisInput, ChapterAnalysisOutput } from "./contracts/chapter-analysis";

export type AiMode = "mock" | "cli-task";

export type AiTaskResult<TOutput> =
  { status: "completed"; output: TOutput } | { status: "waiting_for_cli"; taskDir: string };

// taskId names the data/ai-tasks/{taskId}/ folder: the job record id, or the AI run id when no job exists (seed).
export interface AiTaskContext {
  taskId: string;
}

export interface AiProvider {
  readonly mode: AiMode;
  analyzeChapter(input: ChapterAnalysisInput, context: AiTaskContext): Promise<AiTaskResult<ChapterAnalysisOutput>>;
}
