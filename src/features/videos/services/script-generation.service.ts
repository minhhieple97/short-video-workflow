import { createHash } from "node:crypto";

import { ZodError } from "zod";

import { completeAiRun, failAiRun, markAiRunWaiting, startAiRun } from "@/features/jobs/repositories/ai-run.repository";
import { createAiProvider } from "@/server/ai";
import type { AiProvider, AiTaskContext } from "@/server/ai/ai-provider";
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

import { formatRange, isWithinRange } from "../domain/duration";
import { describeStoryOrderProblem, findStorySceneOrderProblem } from "../domain/narrative-beats";
import { replaceScript, updateSceneRecord } from "../repositories/video.repository";
import { buildSceneRecord, parseIllustration } from "./scene-records";
import { lessonSnapshotsOf } from "./video-mapper";
import { requireVideo } from "./video.service";

interface ScriptRun {
  videoId: string;
  jobRecordId: string | null;
  provider?: AiProvider;
  resume?: AiTaskContext["resume"];
  signal?: AbortSignal;
}

export interface ScriptWaitingForCli {
  waitingForCli: true;
  taskDir: string;
}

type WorkResult<T> = { kind: "waiting"; taskDir: string } | { kind: "done"; value: T; output: unknown };

const inputHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function asAiFailure(error: unknown): unknown {
  return error instanceof ZodError
    ? new AppError("INVALID_AI_OUTPUT", "Kết quả AI không đúng định dạng kịch bản; không thay đổi gì.", 422, {
        cause: error,
      })
    : error;
}

async function withAiRun<T>(
  meta: {
    jobRecordId: string | null;
    mode: string;
    hash: string;
    resume?: AiTaskContext["resume"];
    signal?: AbortSignal;
  },
  work: (context: AiTaskContext) => Promise<WorkResult<T>>,
): Promise<T | ScriptWaitingForCli> {
  const aiRun = await startAiRun({
    jobRecordId: meta.jobRecordId,
    mode: meta.mode,
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    inputHash: meta.hash,
  });
  const taskId = meta.jobRecordId ?? aiRun.id;
  try {
    const result = await work({ taskId, resume: meta.resume, signal: meta.signal });
    if (result.kind === "waiting") {
      await markAiRunWaiting(aiRun.id);
      return { waitingForCli: true, taskDir: result.taskDir };
    }
    const { value, output } = result;
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
  illustration: scene.illustration ?? null,
});

// Builds hook proposals plus the storyboard; the first hook proposal becomes the HOOK scene until the user picks another.
export async function runScriptGeneration(
  run: ScriptRun,
): Promise<{ scenes: number; hookOptions: number } | ScriptWaitingForCli> {
  const video = await requireVideo(run.videoId);
  const provider = run.provider ?? createAiProvider(getAppConfig().ai.mode);
  const input = videoScriptInputSchema.parse({
    videoId: video.id,
    title: video.title,
    minDurationSec: video.minDurationSec,
    maxDurationSec: video.maxDurationSec,
    videoProfile: "SHORT_VERTICAL",
    lessons: lessonSnapshotsOf(video),
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
  });

  const meta = {
    jobRecordId: run.jobRecordId,
    mode: provider.mode,
    hash: inputHash(input),
    resume: run.resume,
    signal: run.signal,
  };
  return withAiRun(meta, async (context) => {
    const result = await provider.generateVideoScript(input, context);
    if (result.status === "waiting_for_cli") return { kind: "waiting", taskDir: result.taskDir };
    const output = videoScriptOutputSchema.parse(result.output);
    if (output.videoId !== video.id) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp video.", 422);
    const [hook] = output.hookOptions;
    if (!hook) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI thiếu phương án hook.", 422);
    const orderProblem = findStorySceneOrderProblem(output.scenes.map((scene) => scene.type));
    if (orderProblem) {
      throw new AppError(
        "INVALID_AI_OUTPUT",
        `Kịch bản AI không theo khung kể: ${describeStoryOrderProblem(orderProblem)} Không thay đổi gì.`,
        422,
      );
    }
    if (!isWithinRange(output.targetDurationSec, video)) {
      throw new AppError(
        "INVALID_AI_OUTPUT",
        `Độ dài AI đề xuất (${output.targetDurationSec} giây) nằm ngoài khoảng ${formatRange(video)}. Không thay đổi gì.`,
        422,
      );
    }

    const scenes = [
      buildSceneRecord({
        type: "HOOK",
        title: "Hook",
        narration: hook.narration,
        onScreenText: hook.onScreenText,
        visualVariant: hook.visualVariant,
        hookVariant: hook.variant,
        illustration: hook.illustration ?? null,
      }),
      ...output.scenes.map((scene) => buildSceneRecord(toSceneContent(scene))),
    ];
    await replaceScript(video.id, {
      hookOptions: output.hookOptions,
      scenes,
      duration: { targetDurationSec: output.targetDurationSec, durationReason: output.durationReason },
    });
    return { kind: "done", value: { scenes: scenes.length, hookOptions: output.hookOptions.length }, output };
  });
}

// Rewrites one scene only; every other scene is left exactly as it was.
export async function runSceneRegeneration(
  run: ScriptRun & { sceneId: string },
): Promise<{ sceneId: string } | ScriptWaitingForCli> {
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

  const meta = {
    jobRecordId: run.jobRecordId,
    mode: provider.mode,
    hash: inputHash(input),
    resume: run.resume,
    signal: run.signal,
  };
  return withAiRun(meta, async (context) => {
    const result = await provider.regenerateScene(input, context);
    if (result.status === "waiting_for_cli") return { kind: "waiting", taskDir: result.taskDir };
    const output = sceneRegenerationOutputSchema.parse(result.output);
    if (output.sceneId !== scene.id) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp cảnh.", 422);
    // Rewriting changes the words only; the scene keeps its picture.
    const record = buildSceneRecord({
      ...toSceneContent(output.scene),
      type: scene.type,
      illustration: parseIllustration(scene.illustrationJson),
    });
    await updateSceneRecord(video.id, scene.id, record, {
      contentChanged: record.contentHash !== scene.contentHash,
      narrationChanged: record.narration !== scene.narration,
    });
    return { kind: "done", value: { sceneId: scene.id }, output };
  });
}
