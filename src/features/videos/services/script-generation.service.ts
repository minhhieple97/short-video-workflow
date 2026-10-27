import { createHash } from "node:crypto";

import { ZodError } from "zod";

import { completeAiRun, createAiRun, failAiRun } from "@/features/jobs/repositories/ai-run.repository";
import { createAiProvider } from "@/server/ai";
import type { AiProvider, AiTaskResult } from "@/server/ai/ai-provider";
import {
  sceneRegenerationInputSchema,
  sceneRegenerationOutputSchema,
  storyboardSceneSchema,
  videoScriptInputSchema,
  videoScriptOutputSchema,
  type StoryboardScene,
} from "@/server/ai/contracts/video-script";
import { VIDEO_SCRIPT_PROMPT_VERSION } from "@/server/ai/prompts/video-script-prompt";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";
import { toSafeErrorMessage } from "@/shared/logger";

import { replaceScript, updateSceneRecord } from "../repositories/video.repository";
import { buildSceneRecord } from "./scene-records";
import { lessonSnapshotsOf } from "./video-mapper";
import { requireVideo } from "./video.service";

interface ScriptRun {
  videoId: string;
  jobRecordId: string | null;
  provider?: AiProvider;
}

const inputHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function asAiFailure(error: unknown): unknown {
  return error instanceof ZodError
    ? new AppError("INVALID_AI_OUTPUT", "Kết quả AI không đúng định dạng kịch bản; không thay đổi gì.", 422, {
        cause: error,
      })
    : error;
}

function completed<T>(result: AiTaskResult<T>): T {
  if (result.status !== "completed")
    throw new AppError("WAITING_FOR_CLI", "Tác vụ đang chờ chạy qua Claude Code CLI.", 409);
  return result.output;
}

async function withAiRun<T>(
  meta: { jobRecordId: string | null; mode: string; hash: string },
  work: (taskId: string) => Promise<{ value: T; output: unknown }>,
): Promise<T> {
  const aiRun = await createAiRun({
    jobRecordId: meta.jobRecordId,
    mode: meta.mode,
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    inputHash: meta.hash,
  });
  const taskId = meta.jobRecordId ?? aiRun.id;
  try {
    const { value, output } = await work(taskId);
    const outputPath = `ai-tasks/${taskId}/output.json`;
    await writeFileAtomic(dataPath(outputPath), `${JSON.stringify(output, null, 2)}\n`);
    await completeAiRun(aiRun.id, outputPath);
    return value;
  } catch (error) {
    const failure = asAiFailure(error);
    await failAiRun(aiRun.id, toSafeErrorMessage(failure));
    throw failure;
  }
}

const toSceneContent = (scene: StoryboardScene) => ({
  type: scene.type,
  title: scene.title ?? null,
  narration: scene.narration,
  onScreenText: scene.onScreenText,
  visualVariant: scene.visualVariant,
  hookVariant: null,
});

// Builds hook proposals plus the storyboard; the first hook proposal becomes the HOOK scene until the user picks another.
export async function runScriptGeneration(run: ScriptRun): Promise<{ scenes: number; hookOptions: number }> {
  const video = await requireVideo(run.videoId);
  const provider = run.provider ?? createAiProvider(getAppConfig().ai.mode);
  const input = videoScriptInputSchema.parse({
    videoId: video.id,
    title: video.title,
    targetDurationSec: video.targetDurationSec,
    videoProfile: "SHORT_VERTICAL",
    lessons: lessonSnapshotsOf(video),
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
  });

  return withAiRun({ jobRecordId: run.jobRecordId, mode: provider.mode, hash: inputHash(input) }, async (taskId) => {
    const output = videoScriptOutputSchema.parse(completed(await provider.generateVideoScript(input, { taskId })));
    if (output.videoId !== video.id) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp video.", 422);
    const [hook] = output.hookOptions;
    if (!hook) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI thiếu phương án hook.", 422);

    const scenes = [
      buildSceneRecord({
        type: "HOOK",
        title: "Hook",
        narration: hook.narration,
        onScreenText: hook.onScreenText,
        visualVariant: hook.visualVariant,
        hookVariant: hook.variant,
      }),
      ...output.scenes.map((scene) => buildSceneRecord(toSceneContent(scene))),
    ];
    await replaceScript(video.id, { hookOptions: output.hookOptions, scenes });
    return { value: { scenes: scenes.length, hookOptions: output.hookOptions.length }, output };
  });
}

// Rewrites one scene only; every other scene is left exactly as it was.
export async function runSceneRegeneration(run: ScriptRun & { sceneId: string }): Promise<{ sceneId: string }> {
  const video = await requireVideo(run.videoId);
  const scene = video.scenes.find((candidate) => candidate.id === run.sceneId);
  if (!scene) throw new NotFoundError("SCENE_NOT_FOUND", "Không tìm thấy cảnh.");
  if (scene.type === "HOOK")
    throw new AppError("HOOK_REQUIRED", "Hãy chọn phương án hook khác thay vì viết lại HOOK.", 409);

  const provider = run.provider ?? createAiProvider(getAppConfig().ai.mode);
  const input = sceneRegenerationInputSchema.parse({
    videoId: video.id,
    sceneId: scene.id,
    attempt: scene.version,
    targetDurationSec: video.targetDurationSec,
    lessons: lessonSnapshotsOf(video),
    scene: storyboardSceneSchema.parse({
      type: scene.type,
      title: scene.title ?? undefined,
      narration: scene.narration,
      onScreenText: scene.onScreenText,
      visualVariant: scene.visualVariant,
    }),
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
  });

  return withAiRun({ jobRecordId: run.jobRecordId, mode: provider.mode, hash: inputHash(input) }, async (taskId) => {
    const output = sceneRegenerationOutputSchema.parse(completed(await provider.regenerateScene(input, { taskId })));
    if (output.sceneId !== scene.id) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp cảnh.", 422);
    const record = buildSceneRecord({ ...toSceneContent(output.scene), type: scene.type });
    await updateSceneRecord(video.id, scene.id, record, record.contentHash !== scene.contentHash);
    return { value: { sceneId: scene.id }, output };
  });
}
