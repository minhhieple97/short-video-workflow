import { z } from "zod";

import type { TargetDurationSec } from "@/features/videos/domain/duration";
import { describeStoryOrderProblem, findStorySceneOrderProblem } from "@/features/videos/domain/narrative-beats";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { hookOptionSchema, storyboardSceneSchema } from "@/server/ai/contracts/video-script";
import type { CallOptions } from "@/server/integrations/call-options";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

export const scenePlanSchema = z
  .object({
    hook: hookOptionSchema,
    scenes: z.array(storyboardSceneSchema).min(1).max(10),
  })
  .superRefine((plan, context) => {
    const problem = findStorySceneOrderProblem(plan.scenes.map((scene) => scene.type));
    if (problem) context.addIssue({ code: "custom", path: ["scenes"], message: describeStoryOrderProblem(problem) });
  });

export type ScenePlan = z.infer<typeof scenePlanSchema>;

export interface ScenePlanRequest {
  draft: ScriptDraft;
  lesson: LessonSnapshot;
  targetDurationSec: TargetDurationSec;
  // The single compile or duration correction allowed per video; null on the first pass.
  revisionNote: string | null;
}

export interface ScenePlanCompiler {
  readonly id: string;
  compile(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan>;
}
