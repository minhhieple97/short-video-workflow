import type { JobType } from "@/shared/types/job";

import type { ChapterAnalysisInput, ChapterAnalysisOutput } from "./contracts/chapter-analysis";
import type { PublishMetadataInput, PublishMetadataOutput } from "./contracts/publish-metadata";
import type {
  SceneRegenerationInput,
  SceneRegenerationOutput,
  VideoScriptInput,
  VideoScriptOutput,
} from "./contracts/video-script";

// cli-auto is the opt-in AutomatedCliProvider: the worker runs the user's own Claude Code CLI.
export type AiMode = "mock" | "cli-task" | "cli-auto";

export type AiTaskResult<TOutput> =
  { status: "completed"; output: TOutput } | { status: "waiting_for_cli"; taskDir: string };

// taskId names data/ai-tasks/{taskId}/ (the job record id, or the AI run id when no job exists).
// resume tells `pnpm ai:run` which job to re-queue once the CLI output is saved; signal cancels a running CLI call.
export interface AiTaskContext {
  taskId: string;
  resume?: { jobType: JobType; payload: Record<string, unknown> };
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly mode: AiMode;
  analyzeChapter(input: ChapterAnalysisInput, context: AiTaskContext): Promise<AiTaskResult<ChapterAnalysisOutput>>;
  generateVideoScript(input: VideoScriptInput, context: AiTaskContext): Promise<AiTaskResult<VideoScriptOutput>>;
  regenerateScene(
    input: SceneRegenerationInput,
    context: AiTaskContext,
  ): Promise<AiTaskResult<SceneRegenerationOutput>>;
  generatePublishMetadata(
    input: PublishMetadataInput,
    context: AiTaskContext,
  ): Promise<AiTaskResult<PublishMetadataOutput>>;
}
