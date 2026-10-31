import { createHash } from "node:crypto";

import { askClaude } from "@/server/ai/cli-task/ask-claude";
import { readTaskOutput, writeTaskFiles, writeTaskOutput } from "@/server/ai/cli-task/task-files";
import {
  buildScenePlanPrompt,
  buildStoryScenePlanPrompt,
  SCENE_PLAN_PROMPT_VERSION,
} from "@/server/ai/prompts/scene-plan-prompt";
import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";
import { AppError } from "@/shared/errors";
import { getAppConfig } from "@/shared/config/env";
import { stableStringify } from "@/shared/stable-json";

import { scenePlanTaskInputSchema } from "./handoff";
import { scenePlanSchema, type ScenePlan, type ScenePlanCompiler, type ScenePlanRequest } from "./scene-plan-compiler";
import { findUnsupportedClaims, hasUnsupportedClaims } from "./source-guard";
import { ScenePlanWaitingError, validateStoryScenePlan } from "./story-scene-plan";

const KIND_BY_CODE: Record<string, IntegrationFailureKind> = {
  AI_CLI_AUTH: "AUTH",
  AI_QUOTA_EXCEEDED: "QUOTA",
  AI_CLI_MISSING: "REJECTED",
  AI_CLI_MODEL_UNAVAILABLE: "REJECTED",
  INVALID_AI_OUTPUT: "REJECTED",
  AI_CLI_TIMEOUT: "TRANSIENT",
  AI_CLI_ERROR: "TRANSIENT",
};

// askClaude reports through AppError codes; the port speaks IntegrationError. A cancellation is not a failure and passes
// through untouched.
function toIntegrationError(error: unknown): unknown {
  if (error instanceof IntegrationError) return error;
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
    if (request.story) return this.compileStory(request, options);
    const input = scenePlanTaskInputSchema.parse({
      draft: request.draft,
      lesson: request.lesson,
      book: request.book,
      targetDurationSec: request.targetDurationSec,
      ...request.range,
      pace: request.pace,
      revisionNote: request.revisionNote,
      promptVersion: SCENE_PLAN_PROMPT_VERSION,
    });
    const ai = getAppConfig().ai;
    const model = request.execution?.model ?? ai.claudeModel;
    const effort = request.execution?.effort ?? ai.claudeEffort;
    const taskId = taskIdFor(
      stableStringify(model || effort ? { input, ...(model ? { model } : {}), ...(effort ? { effort } : {}) } : input),
    );

    const saved = scenePlanSchema.safeParse(await readTaskOutput(taskId));
    if (saved.success) return saved.data;

    await writeTaskFiles(
      {
        taskId,
        kind: "scene-plan",
        promptVersion: SCENE_PLAN_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
        resume: null,
        ...(request.execution ? { execution: request.execution } : {}),
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

  private async compileStory(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan> {
    const story = request.story;
    if (!story || !request.execution)
      throw new AppError(
        "SCENE_PLAN_INPUT_INVALID",
        "Thiếu nguồn, nhân vật hoặc cấu hình model của kế hoạch cảnh.",
        422,
      );
    const input = {
      story,
      revisionNote: request.revisionNote,
      promptVersion: SCENE_PLAN_PROMPT_VERSION,
      execution: request.execution,
    };
    const taskId = request.taskContext?.taskId ?? taskIdFor(stableStringify(input));
    const saved = await readTaskOutput(taskId);
    if (saved !== undefined) return validateStoryScenePlan(saved, story);
    const directory = await writeTaskFiles(
      {
        taskId,
        kind: "story-scene-plan",
        promptVersion: SCENE_PLAN_PROMPT_VERSION,
        createdAt: new Date().toISOString(),
        resume: request.taskContext?.resume ?? null,
        stage: "scene",
        execution: request.execution,
      },
      input,
      buildStoryScenePlanPrompt(story, request.revisionNote),
    );
    if (request.mode === "cli-task") throw new ScenePlanWaitingError(directory);
    let candidate: unknown;
    try {
      candidate = await askClaude(taskId, "story-scene-plan", { signal: options?.signal });
    } catch (error) {
      throw toIntegrationError(error);
    }
    const plan = validateStoryScenePlan(candidate, story);
    const claims = findUnsupportedClaims(plan, story.draft, request.lesson);
    if (hasUnsupportedClaims(claims))
      throw new IntegrationError(
        "SCENE_PLAN_UNSUPPORTED_CLAIM",
        "Kế hoạch cảnh thêm số liệu hoặc trích dẫn ngoài kịch bản đã chốt.",
        "REJECTED",
      );
    await writeTaskOutput(taskId, plan);
    return plan;
  }
}
