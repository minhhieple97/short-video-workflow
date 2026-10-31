import type { AiMode, AiTaskContext, AiTaskResult } from "@/server/ai/ai-provider";
import { askClaude } from "@/server/ai/cli-task/ask-claude";
import { readTaskOutput, writeTaskFiles, writeTaskOutput } from "@/server/ai/cli-task/task-files";
import { buildScriptDraftPrompt } from "@/server/ai/prompts/script-draft-prompt";

import { SCRIPT_DRAFT_PROMPT_VERSION, validateStoryDraft, type DraftRequest, type StoryDraft } from "./contracts";
import type { ScriptDraftWriter } from "./script-draft-writer";

export class ClaudeScriptDraftWriter implements ScriptDraftWriter {
  readonly id = "claude-script-draft";
  constructor(private readonly mode: Exclude<AiMode, "mock">) {}

  async writeDraft(request: DraftRequest, context: AiTaskContext): Promise<AiTaskResult<StoryDraft>> {
    context.signal?.throwIfAborted();
    const saved = await readTaskOutput(context.taskId);
    if (saved !== undefined) return { status: "completed", output: validateStoryDraft(saved, request) };
    const taskDir = await writeTaskFiles(
      {
        taskId: context.taskId,
        kind: "script-draft",
        promptVersion: SCRIPT_DRAFT_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
        resume: context.resume ?? null,
        stage: "draft",
        execution: request.settings.script,
      },
      request,
      buildScriptDraftPrompt(request),
    );
    if (this.mode === "cli-task") return { status: "waiting_for_cli", taskDir };
    const output = validateStoryDraft(
      await askClaude(context.taskId, "script-draft", { signal: context.signal }),
      request,
    );
    await writeTaskOutput(context.taskId, output);
    return { status: "completed", output };
  }
}
