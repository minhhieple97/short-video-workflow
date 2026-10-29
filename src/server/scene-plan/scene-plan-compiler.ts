import { z } from "zod";

import { MAX_STORY_SCENES, type DurationRange, type TargetDurationSec } from "@/features/videos/domain/duration";
import { describeStoryOrderProblem, findStorySceneOrderProblem } from "@/features/videos/domain/narrative-beats";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type { Pace } from "@/features/videos/domain/pace";
import { hookOptionSchema, storyboardSceneSchema } from "@/server/ai/contracts/video-script";
import type { CallOptions } from "@/server/integrations/call-options";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

export const scenePlanSchema = z
  .object({
    hook: hookOptionSchema,
    scenes: z.array(storyboardSceneSchema).min(1).max(MAX_STORY_SCENES),
  })
  .superRefine((plan, context) => {
    const problem = findStorySceneOrderProblem(plan.scenes.map((scene) => scene.type));
    if (problem) context.addIssue({ code: "custom", path: ["scenes"], message: describeStoryOrderProblem(problem) });
  });

export type ScenePlan = z.infer<typeof scenePlanSchema>;

export interface ScenePlanRequest {
  draft: ScriptDraft;
  lesson: LessonSnapshot;
  // The length the draft was written for, and the range the final video must stay in.
  targetDurationSec: TargetDurationSec;
  range: DurationRange;
  // How fast the narration will be voiced: the plan keeps to the words that fit the length at that speed.
  pace: Pace;
  // The single compile or duration correction allowed per video; null on the first pass.
  revisionNote: string | null;
}

export interface ScenePlanCompiler {
  readonly id: string;
  compile(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan>;
}
