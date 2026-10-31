import { z } from "zod";

import { castSnapshotSchema, type CastSnapshot } from "@/features/videos/domain/characters";
import { MAX_STORY_SCENES } from "@/features/videos/domain/duration";
import { SCENE_TYPE_FOR_BEAT } from "@/features/videos/domain/narrative-beats";
import { aiShotSchema, MAX_HOOK_SHOTS, MAX_SHOTS_PER_SCENE } from "@/features/videos/domain/shot-plan";
import { normalizedSourceText, scriptSourcePackSchema } from "@/features/videos/domain/script-source-pack";
import { generationInputSchema, storyDraftSchema } from "@/server/script-draft/contracts";
import { AppError } from "@/shared/errors";

import { scenePlanSchema } from "./scene-plan-compiler";

const strictShot = aiShotSchema.extend({ actors: aiShotSchema.shape.actors.unwrap() });
export const storyScenePlanSchema = scenePlanSchema.safeExtend({
  schemaVersion: z.literal("story-scene-plan-v2"),
  hook: scenePlanSchema.shape.hook.extend({ shots: z.array(strictShot).min(1).max(MAX_HOOK_SHOTS) }),
  scenes: z
    .array(scenePlanSchema.shape.scenes.element.extend({ shots: z.array(strictShot).min(1).max(MAX_SHOTS_PER_SCENE) }))
    .min(1)
    .max(MAX_STORY_SCENES),
});
export type StoryScenePlan = z.infer<typeof storyScenePlanSchema>;
export const storySceneContextSchema = z.object({
  draft: storyDraftSchema,
  cast: castSnapshotSchema,
  sourcePack: scriptSourcePackSchema,
  input: generationInputSchema,
});
export type StorySceneContext = z.infer<typeof storySceneContextSchema>;

export class ScenePlanWaitingError extends Error {
  constructor(readonly taskDir: string) {
    super("Scene plan is waiting for Claude CLI.");
  }
}

export function validateStoryScenePlan(candidate: unknown, context: StorySceneContext): StoryScenePlan {
  const plan = storyScenePlanSchema.parse(candidate);
  const [hookBeat, ...beats] = context.draft.beats;
  if (
    normalizedSourceText(plan.hook.narration) !== normalizedSourceText(hookBeat?.narration ?? "") ||
    plan.scenes.length !== beats.length ||
    plan.scenes.some((scene, index) => {
      const beat = beats[index];
      return (
        !beat ||
        scene.type !== SCENE_TYPE_FOR_BEAT[beat.beat] ||
        normalizedSourceText(scene.narration) !== normalizedSourceText(beat.narration)
      );
    })
  )
    throw new AppError(
      "SCENE_PLAN_STORY_CHANGED",
      "Kế hoạch cảnh đã đổi lời kể hoặc mạch truyện của bản thảo. Hãy sửa ở bước viết kịch bản.",
      422,
    );
  assertPlanCast(plan, context.cast);
  return plan;
}

export function assertPlanCast(plan: StoryScenePlan, cast: CastSnapshot): void {
  const ids = new Set(cast.profiles.map((profile) => profile.id));
  for (const scene of [plan.hook, ...plan.scenes]) {
    for (const shot of scene.shots) {
      if (
        shot.partner ||
        shot.actors.some((actor) => !ids.has(actor.characterId)) ||
        (!shot.card && shot.actors.length === 0)
      )
        throw new AppError(
          "SCENE_PLAN_CAST_INVALID",
          "Shot phải dùng đúng ID trong dàn nhân vật; tối đa hai người mỗi shot.",
          422,
        );
    }
  }
}
