import type { z } from "zod";

import type { AiMode, AiProvider, AiTaskContext, AiTaskResult } from "./ai-provider";
import { TASK_OUTPUT_SCHEMAS, readTaskOutput, writeTaskFiles, type TaskKind } from "./cli-task/task-files";
import type { ChapterAnalysisInput, ChapterAnalysisOutput } from "./contracts/chapter-analysis";
import type {
  SceneRegenerationInput,
  SceneRegenerationOutput,
  VideoScriptInput,
  VideoScriptOutput,
} from "./contracts/video-script";
import { buildChapterAnalysisPrompt } from "./prompts/chapter-analysis-prompt";
import { buildSceneRegenerationPrompt, buildVideoScriptPrompt } from "./prompts/video-script-prompt";

// The Studio never calls Claude itself: it writes a task, waits, and the user runs `pnpm ai:run --job <id>` in their terminal.
export class LocalCliTaskProvider implements AiProvider {
  readonly mode: AiMode = "cli-task";

  analyzeChapter(input: ChapterAnalysisInput, context: AiTaskContext): Promise<AiTaskResult<ChapterAnalysisOutput>> {
    const schema = TASK_OUTPUT_SCHEMAS["chapter-analysis"];
    return this.run("chapter-analysis", schema, input, input.promptVersion, buildChapterAnalysisPrompt(input), context);
  }

  generateVideoScript(input: VideoScriptInput, context: AiTaskContext): Promise<AiTaskResult<VideoScriptOutput>> {
    const schema = TASK_OUTPUT_SCHEMAS["video-script"];
    return this.run("video-script", schema, input, input.promptVersion, buildVideoScriptPrompt(input), context);
  }

  regenerateScene(
    input: SceneRegenerationInput,
    context: AiTaskContext,
  ): Promise<AiTaskResult<SceneRegenerationOutput>> {
    const schema = TASK_OUTPUT_SCHEMAS["scene-regeneration"];
    return this.run(
      "scene-regeneration",
      schema,
      input,
      input.promptVersion,
      buildSceneRegenerationPrompt(input),
      context,
    );
  }

  private async run<T>(
    kind: TaskKind,
    schema: z.ZodType<T>,
    input: unknown,
    promptVersion: string,
    prompt: string,
    context: AiTaskContext,
  ): Promise<AiTaskResult<T>> {
    const existing = await readTaskOutput(context.taskId);
    if (existing !== undefined) return { status: "completed", output: schema.parse(existing) };
    const taskDir = await writeTaskFiles(
      {
        taskId: context.taskId,
        kind,
        promptVersion,
        createdAt: new Date().toISOString(),
        resume: context.resume ?? null,
      },
      input,
      prompt,
    );
    return this.afterTaskWritten(kind, schema, taskDir, context);
  }

  // The task now waits for the user to run `pnpm ai:run --job <id>`; AutomatedCliProvider runs it right away instead.
  protected afterTaskWritten<T>(
    _kind: TaskKind,
    _schema: z.ZodType<T>,
    taskDir: string,
    _context: AiTaskContext,
  ): Promise<AiTaskResult<T>> {
    return Promise.resolve({ status: "waiting_for_cli", taskDir });
  }
}
