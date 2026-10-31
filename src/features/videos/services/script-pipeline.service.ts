import { captureCast, castSnapshotSchema } from "@/features/videos/domain/characters";
import type { AiMode, AiTaskContext } from "@/server/ai/ai-provider";
import { createScriptDraftWriter } from "@/server/script-draft";
import type { ScriptDraftWriter } from "@/server/script-draft/script-draft-writer";
import { SCRIPT_DRAFT_PROMPT_VERSION, validateStoryDraft, type DraftRequest } from "@/server/script-draft/contracts";
import {
  createStoryDraftArtifact,
  createStorySceneArtifact,
  generationHash,
  storyDraftArtifactSchema,
  storySceneArtifactSchema,
  type StoryDraftArtifact,
  type StorySceneArtifact,
} from "@/server/script-draft/artifacts";
import { createScenePlanCompiler } from "@/server/scene-plan";
import type { ScenePlanCompiler } from "@/server/scene-plan/scene-plan-compiler";
import { ScenePlanWaitingError, validateStoryScenePlan } from "@/server/scene-plan/story-scene-plan";
import { SCENE_PLAN_PROMPT_VERSION } from "@/server/ai/prompts/scene-plan-prompt";
import { AppError } from "@/shared/errors";

import { toPace, syllablesPerSecond } from "../domain/pace";
import { planShots } from "../domain/shot-plan";
import { saveGenerationArtifact } from "../repositories/script-generation-run.repository";
import type { ReplacementScript } from "../repositories/video.repository";
import { withAiRun, type AiWaitingForCli } from "./ai-run";
import { prepareGenerationRun } from "./script-generation-run.service";
import { buildSceneRecord } from "./scene-records";
import { publishWriteFor } from "./publish-proposal";

export interface GenerationStageRun {
  generationRunId: string;
  jobRecordId: string | null;
  mode: AiMode;
  resume?: AiTaskContext["resume"];
  signal?: AbortSignal;
  revisionNote?: string | null;
}

export async function writeGenerationDraft(
  run: GenerationStageRun,
  writer?: ScriptDraftWriter,
): Promise<StoryDraftArtifact | AiWaitingForCli> {
  const generation = await prepareGenerationRun(run.generationRunId);
  const request: DraftRequest = {
    input: generation.input,
    settings: generation.settings,
    sourcePack: generation.sourcePack,
    revisionNote: run.revisionNote ?? null,
    ...(generation.row.ownerKey.endsWith(":correction") && generation.row.castJson !== null
      ? { fixedCast: castSnapshotSchema.parse(generation.row.castJson) }
      : {}),
  };
  const hash = generationHash({ generationRunId: generation.row.id, request, mode: run.mode });
  const existing = storyDraftArtifactSchema.safeParse(generation.row.draftArtifactJson);
  if (existing.success && existing.data.inputHash === hash) {
    validateStoryDraft(existing.data.draft, request);
    return existing.data;
  }
  if (generation.row.draftArtifactJson !== null)
    throw new AppError(
      "SCRIPT_GENERATION_INPUT_CHANGED",
      "Đầu vào lần tạo không còn khớp bản thảo đã lưu. Hãy tạo một lần mới.",
      409,
    );
  return withAiRun(
    {
      jobRecordId: run.jobRecordId,
      mode: run.mode,
      hash,
      stage: "draft",
      taskId: `script-draft-${hash}`,
      execution: generation.settings.script,
      promptVersion: SCRIPT_DRAFT_PROMPT_VERSION,
      invalidOutputMessage: "Bản thảo không đúng hợp đồng kịch bản.",
      resume: run.resume,
      signal: run.signal,
    },
    async (context) => {
      const result = await (writer ?? createScriptDraftWriter(run.mode)).writeDraft(request, context);
      if (result.status === "waiting_for_cli") return { kind: "waiting", taskDir: result.taskDir };
      const draft = validateStoryDraft(result.output, request);
      const cast = captureCast(generation.settings.characters, draft.cast);
      const artifact = createStoryDraftArtifact(draft, hash);
      const saved = await saveGenerationArtifact(generation.row.id, "draft", artifact, cast);
      const winner = storyDraftArtifactSchema.parse(saved.draftArtifactJson);
      validateStoryDraft(winner.draft, request);
      return { kind: "done", value: winner, output: winner.draft };
    },
  );
}

export async function compileGenerationPlan(
  run: GenerationStageRun,
  compiler?: ScenePlanCompiler,
): Promise<StorySceneArtifact | AiWaitingForCli> {
  const generation = await prepareGenerationRun(run.generationRunId);
  const draftArtifact = storyDraftArtifactSchema.parse(generation.row.draftArtifactJson);
  const cast = castSnapshotSchema.parse(generation.row.castJson);
  const story = { draft: draftArtifact.draft, cast, sourcePack: generation.sourcePack, input: generation.input };
  const hash = generationHash({
    generationRunId: generation.row.id,
    story,
    execution: generation.settings.scene,
    mode: run.mode,
    promptVersion: SCENE_PLAN_PROMPT_VERSION,
    revisionNote: run.revisionNote ?? null,
  });
  const existing = storySceneArtifactSchema.safeParse(generation.row.scenePlanArtifactJson);
  if (existing.success && existing.data.inputHash === hash) {
    validateStoryScenePlan(existing.data.plan, story);
    return existing.data;
  }
  if (generation.row.scenePlanArtifactJson !== null)
    throw new AppError("SCRIPT_GENERATION_INPUT_CHANGED", "Đầu vào lần tạo không còn khớp kế hoạch cảnh đã lưu.", 409);
  const lesson = generation.input.lessons[0];
  if (!lesson) throw new AppError("SCRIPT_SOURCE_MISSING", "Video không có bài học nguồn.", 409);
  return withAiRun(
    {
      jobRecordId: run.jobRecordId,
      mode: run.mode,
      hash,
      stage: "scene",
      taskId: `scene-plan-${hash}`,
      execution: generation.settings.scene,
      promptVersion: SCENE_PLAN_PROMPT_VERSION,
      invalidOutputMessage: "Kế hoạch cảnh không đúng hợp đồng.",
      resume: run.resume,
      signal: run.signal,
    },
    async (context) => {
      try {
        const output = await (
          compiler ?? createScenePlanCompiler(run.mode === "cli-task" ? "cli-auto" : run.mode)
        ).compile(
          {
            draft: story.draft,
            lesson,
            book: generation.input.book,
            targetDurationSec: story.draft.targetDurationSec,
            range: generation.input,
            pace: generation.input.pace,
            revisionNote: run.revisionNote ?? null,
            story,
            execution: generation.settings.scene,
            taskContext: context,
            mode: run.mode,
          },
          { signal: run.signal },
        );
        const plan = validateStoryScenePlan(output, story);
        const artifact = createStorySceneArtifact({
          plan,
          inputHash: hash,
          draftFingerprint: draftArtifact.fingerprint,
          promptVersion: SCENE_PLAN_PROMPT_VERSION,
          targetDurationSec: story.draft.targetDurationSec,
        });
        const saved = await saveGenerationArtifact(generation.row.id, "scene", artifact);
        const winner = storySceneArtifactSchema.parse(saved.scenePlanArtifactJson);
        validateStoryScenePlan(winner.plan, story);
        return { kind: "done", value: winner, output: winner.plan };
      } catch (error) {
        if (error instanceof ScenePlanWaitingError) return { kind: "waiting", taskDir: error.taskDir };
        throw error;
      }
    },
  );
}

export async function generationReplacement(generationRunId: string): Promise<ReplacementScript> {
  const generation = await prepareGenerationRun(generationRunId);
  const draftArtifact = storyDraftArtifactSchema.parse(generation.row.draftArtifactJson);
  const artifact = storySceneArtifactSchema.parse(generation.row.scenePlanArtifactJson);
  if (artifact.draftFingerprint !== draftArtifact.fingerprint)
    throw new AppError("SCRIPT_GENERATION_STALE_PLAN", "Kế hoạch cảnh không còn khớp bản thảo.", 409);
  const plan = artifact.plan;
  const rate = syllablesPerSecond(toPace(generation.input.pace));
  const scenes = [
    buildSceneRecord(
      {
        type: "HOOK",
        title: "Hook",
        narration: plan.hook.narration,
        onScreenText: plan.hook.onScreenText,
        visualVariant: plan.hook.visualVariant,
        hookVariant: plan.hook.variant,
        illustration: plan.hook.illustration ?? null,
        shots: planShots(plan.hook.narration, plan.hook.shots, 2),
      },
      rate,
    ),
    ...plan.scenes.map((scene) =>
      buildSceneRecord(
        {
          type: scene.type,
          title: scene.title ?? null,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          visualVariant: scene.visualVariant,
          hookVariant: null,
          illustration: scene.illustration ?? null,
          shots: planShots(scene.narration, scene.shots),
        },
        rate,
      ),
    ),
  ];
  return {
    hookOptions: draftArtifact.draft.hookOptions.map((hook, index) =>
      index === 0 ? { ...hook, shots: plan.hook.shots } : hook,
    ),
    scenes,
    duration: {
      targetDurationSec: draftArtifact.draft.targetDurationSec,
      durationReason: draftArtifact.draft.durationReason,
    },
    generation: { id: generation.row.id },
    ...publishWriteFor(plan.publish, {
      logIds: { videoId: generation.row.videoId },
      promptVersion: artifact.promptVersion,
      book: generation.input.book,
      lessons: generation.input.lessons,
      scenes,
    }),
  };
}
