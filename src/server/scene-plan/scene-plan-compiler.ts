import { z } from "zod";

import { MAX_STORY_SCENES, type DurationRange, type TargetDurationSec } from "@/features/videos/domain/duration";
import { describeStoryOrderProblem, findStorySceneOrderProblem } from "@/features/videos/domain/narrative-beats";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { publishMetadataDraftSchema, type PublishBook } from "@/server/ai/contracts/publish-metadata";
import { hookOptionSchema, storyboardSceneSchema } from "@/server/ai/contracts/video-script";
import type { CallOptions } from "@/server/integrations/call-options";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

export const scenePlanSchema = z
  .object({
    hook: hookOptionSchema,
    scenes: z.array(storyboardSceneSchema).min(1).max(MAX_STORY_SCENES),
    // Optional with no default, so a plan stored before it existed keeps its fingerprint; loosely typed, so a caption that
    // breaks a rule is dropped when the plan is applied instead of rejecting the scenes.
    publish: publishMetadataDraftSchema.optional(),
  })
  .superRefine((plan, context) => {
    const problem = findStorySceneOrderProblem(plan.scenes.map((scene) => scene.type));
    if (problem) context.addIssue({ code: "custom", path: ["scenes"], message: describeStoryOrderProblem(problem) });
  });

export type ScenePlan = z.infer<typeof scenePlanSchema>;

export interface ScenePlanRequest {
  draft: ScriptDraft;
  lesson: LessonSnapshot;
  // For the caption's source line.
  book: PublishBook;
  // The length the draft was written for, and the range the final video must stay in.
  targetDurationSec: TargetDurationSec;
  range: DurationRange;
  // The single compile or duration correction allowed per video; null on the first pass.
  revisionNote: string | null;
}

export interface ScenePlanCompiler {
  readonly id: string;
  compile(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan>;
}
