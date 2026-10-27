import type { z } from "zod";

import type { AiMode, AiTaskContext, AiTaskResult } from "./ai-provider";
import { askClaude } from "./cli-task/ask-claude";
import { writeTaskOutput, type TaskKind } from "./cli-task/task-files";
import { LocalCliTaskProvider } from "./local-cli-task-provider";

// Opt-in (AI_MODE=cli-auto, requirements §9.2C): the worker runs the task through the user's own logged-in Claude Code
// CLI immediately instead of waiting for `pnpm ai:run`. Same prompt, schema, sanitized env and no-tools flags; one call
// at a time because the worker runs one job at a time. Personal, localhost use only.
export class AutomatedCliProvider extends LocalCliTaskProvider {
  override readonly mode: AiMode = "cli-auto";

  protected override async afterTaskWritten<T>(
    kind: TaskKind,
    schema: z.ZodType<T>,
    _taskDir: string,
    context: AiTaskContext,
  ): Promise<AiTaskResult<T>> {
    const output = schema.parse(await askClaude(context.taskId, kind, { signal: context.signal }));
    await writeTaskOutput(context.taskId, output);
    return { status: "completed", output };
  }
}
