import { createHash } from "node:crypto";

import { askClaude } from "@/server/ai/cli-task/ask-claude";
import { readTaskOutput, writeTaskFiles, writeTaskOutput } from "@/server/ai/cli-task/task-files";
import { buildScenePlanPrompt, SCENE_PLAN_PROMPT_VERSION } from "@/server/ai/prompts/scene-plan-prompt";
import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";
import { AppError } from "@/shared/errors";
import { stableStringify } from "@/shared/stable-json";

import { scenePlanTaskInputSchema } from "./handoff";
import { scenePlanSchema, type ScenePlan, type ScenePlanCompiler, type ScenePlanRequest } from "./scene-plan-compiler";
import { findUnsupportedClaims, hasUnsupportedClaims } from "./source-guard";

const KIND_BY_CODE: Record<string, IntegrationFailureKind> = {
  AI_CLI_AUTH: "AUTH",
  AI_QUOTA_EXCEEDED: "QUOTA",
  AI_CLI_MISSING: "REJECTED",
  INVALID_AI_OUTPUT: "REJECTED",
  AI_CLI_TIMEOUT: "TRANSIENT",
  AI_CLI_ERROR: "TRANSIENT",
};

// askClaude reports through AppError codes; the port speaks IntegrationError. A cancellation is not a failure and passes
// through untouched.
function toIntegrationError(error: unknown): unknown {
  if (!(error instanceof AppError)) return error;
  const kind = KIND_BY_CODE[error.code];
  return kind ? new IntegrationError(error.code, error.message, kind, { cause: error }) : error;
}

// The task is named after its exact input, so asking again for the same draft, lesson, length and correction note finds
// the saved result instead of spending another Claude call, while any change to that input is a new task.
const taskIdFor = (inputJson: string): string =>
  `scene-plan-${createHash("sha256").update(inputJson).digest("hex").slice(0, 24)}`;

// Compiles a draft into a scene plan with the user's own Claude Code CLI, through the same askClaude() as every other
// task: no tools, no MCP servers, sanitized environment, JSON only, output validated against the scene-plan schema.
export class ClaudeScenePlanCompiler implements ScenePlanCompiler {
  readonly id = "claude-scene-plan";

  async compile(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan> {
    options?.signal?.throwIfAborted();
    const input = scenePlanTaskInputSchema.parse({
      draft: request.draft,
      lesson: request.lesson,
      targetDurationSec: request.targetDurationSec,
      ...request.range,
      pace: request.pace,
      revisionNote: request.revisionNote,
      promptVersion: SCENE_PLAN_PROMPT_VERSION,
    });
    const taskId = taskIdFor(stableStringify(input));

    const saved = scenePlanSchema.safeParse(await readTaskOutput(taskId));
    if (saved.success) return saved.data;

    await writeTaskFiles(
      {
        taskId,
        kind: "scene-plan",
        promptVersion: SCENE_PLAN_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
        resume: null,
      },
      input,
      buildScenePlanPrompt(input),
    );

    let plan: ScenePlan;
    try {
      plan = scenePlanSchema.parse(await askClaude(taskId, "scene-plan", { signal: options?.signal }));
    } catch (error) {
      throw toIntegrationError(error);
    }

    // Only a plan that stays within the source is saved, so a rejected one can be asked for again.
    const claims = findUnsupportedClaims(plan, request.draft, request.lesson);
    if (hasUnsupportedClaims(claims)) {
      throw new IntegrationError(
        "SCENE_PLAN_UNSUPPORTED_CLAIM",
        "Kế hoạch cảnh có số liệu hoặc trích dẫn không có trong bản thảo và bài học nguồn.",
        "REJECTED",
        { details: { ...claims } },
      );
    }
    await writeTaskOutput(taskId, plan);
    return plan;
  }
}
