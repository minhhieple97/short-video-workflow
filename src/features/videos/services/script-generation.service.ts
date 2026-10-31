import { createAiProvider } from "@/server/ai";
import type { AiProvider, AiTaskContext } from "@/server/ai/ai-provider";
import {
  sceneRegenerationInputSchema,
  rewrittenSceneSchema,
  sceneRegenerationOutputSchema,
  videoScriptInputSchema,
  videoScriptOutputSchema,
  type RewrittenScene,
  type StoryboardScene,
} from "@/server/ai/contracts/video-script";
import { VIDEO_SCRIPT_PROMPT_VERSION } from "@/server/ai/prompts/video-script-prompt";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";

import { formatRange, isWithinRange } from "../domain/duration";
import { toPace } from "../domain/pace";
import { describeStoryOrderProblem, findStorySceneOrderProblem } from "../domain/narrative-beats";
import { parseShotPlan, planShots, rebaseShotPlan } from "../domain/shot-plan";
import { pickStoryAngle } from "../domain/story-angle";
import { replaceScript, updateSceneRecord } from "../repositories/video.repository";
import { inputHash, withAiRun, type AiWaitingForCli } from "./ai-run";
import { publishWriteFor } from "./publish-proposal";
import { buildSceneRecord, narrationRateOf, parseIllustration } from "./scene-records";
import { lessonSnapshotsOf } from "./video-mapper";
import { requireVideo } from "./video.service";

interface ScriptRun {
  videoId: string;
  jobRecordId: string | null;
  provider?: AiProvider;
  resume?: AiTaskContext["resume"];
  signal?: AbortSignal;
}

const INVALID_SCRIPT_OUTPUT = "Kết quả AI không đúng định dạng kịch bản; không thay đổi gì.";

const toSceneContent = (scene: StoryboardScene | RewrittenScene) => ({
  type: scene.type,
  title: scene.title ?? null,
  narration: scene.narration,
  onScreenText: scene.onScreenText,
  visualVariant: scene.visualVariant,
  hookVariant: null,
  illustration: scene.illustration ?? null,
});

const toStoryboardContent = (scene: StoryboardScene) => ({
  ...toSceneContent(scene),
  shots: planShots(scene.narration, scene.shots),
});

// Builds hook proposals plus the storyboard; the first hook proposal becomes the HOOK scene until the user picks another.
export async function runScriptGeneration(
  run: ScriptRun,
): Promise<{ scenes: number; hookOptions: number } | AiWaitingForCli> {
  const video = await requireVideo(run.videoId);
  const provider = run.provider ?? createAiProvider(getAppConfig().ai.mode);
  const input = videoScriptInputSchema.parse({
    videoId: video.id,
    title: video.title,
    minDurationSec: video.minDurationSec,
    maxDurationSec: video.maxDurationSec,
    pace: toPace(video.pace),
    // scriptVersion grows each time a script is stored, so writing the script again moves on to the next angle.
    storyAngle: pickStoryAngle(video.id, video.scriptVersion),
    videoProfile: "SHORT_VERTICAL",
    book: { title: video.book.title, author: video.book.author },
    lessons: lessonSnapshotsOf(video),
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
  });

  const meta = {
    jobRecordId: run.jobRecordId,
    mode: provider.mode,
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    hash: inputHash(input),
    invalidOutputMessage: INVALID_SCRIPT_OUTPUT,
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

    const rate = narrationRateOf(video);
    const scenes = [
      buildSceneRecord(
        {
          type: "HOOK",
          title: "Hook",
          narration: hook.narration,
          onScreenText: hook.onScreenText,
          visualVariant: hook.visualVariant,
          hookVariant: hook.variant,
          illustration: hook.illustration ?? null,
        },
        rate,
      ),
      ...output.scenes.map((scene) => buildSceneRecord(toStoryboardContent(scene), rate)),
    ];
    await replaceScript(video.id, {
      hookOptions: output.hookOptions,
      scenes,
      duration: { targetDurationSec: output.targetDurationSec, durationReason: output.durationReason },
      publish: publishWriteFor(output.publish, {
        logIds: { videoId: video.id },
        promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
        book: input.book,
        lessons: input.lessons,
        scenes,
      }),
    });
    return { kind: "done", value: { scenes: scenes.length, hookOptions: output.hookOptions.length }, output };
  });
}

// Rewrites one scene only; every other scene is left exactly as it was.
export async function runSceneRegeneration(
  run: ScriptRun & { sceneId: string },
): Promise<{ sceneId: string } | AiWaitingForCli> {
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
    pace: toPace(video.pace),
    lessons: lessonSnapshotsOf(video),
    scene: rewrittenSceneSchema.parse({
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
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    hash: inputHash(input),
    invalidOutputMessage: INVALID_SCRIPT_OUTPUT,
    resume: run.resume,
    signal: run.signal,
  };
  return withAiRun(meta, async (context) => {
    const result = await provider.regenerateScene(input, context);
    if (result.status === "waiting_for_cli") return { kind: "waiting", taskDir: result.taskDir };
    const output = sceneRegenerationOutputSchema.parse(result.output);
    if (output.sceneId !== scene.id) throw new AppError("INVALID_AI_OUTPUT", "Kết quả AI không khớp cảnh.", 422);
    // Rewriting changes the words only; the scene keeps its picture, its shots moving onto the new words.
    const previousShots = parseShotPlan(scene.shotsJson);
    const record = buildSceneRecord(
      {
        ...toSceneContent(output.scene),
        type: scene.type,
        illustration: parseIllustration(scene.illustrationJson),
        shots: previousShots ? rebaseShotPlan(previousShots, scene.narration, output.scene.narration) : null,
      },
      narrationRateOf(video),
    );
    await updateSceneRecord(video.id, scene.id, record, {
      contentChanged: record.contentHash !== scene.contentHash,
      narrationChanged: record.narration !== scene.narration,
    });
    return { kind: "done", value: { sceneId: scene.id }, output };
  });
}
