import type { NarrativeBeat } from "@/features/videos/domain/narrative-beats";
import type { BodySceneType } from "@/features/videos/domain/scene-types";
import type { CallOptions } from "@/server/integrations/call-options";
import type { ScenePlan, ScenePlanCompiler, ScenePlanRequest } from "@/server/scene-plan/scene-plan-compiler";

const SCENE_TYPE_FOR_BEAT: Record<Exclude<NarrativeBeat, "HOOK">, BodySceneType> = {
  SITUATION: "SITUATION",
  MISTAKE: "COMMON_MISTAKE",
  LESSON: "KEY_TAKEAWAY",
  RESOLUTION: "BETTER_APPROACH",
  ACTION: "ACTION_STEP",
};

// Deterministic and offline (AI_MODE=mock): turns each draft beat into its scene without rewording anything.
export class MockScenePlanCompiler implements ScenePlanCompiler {
  readonly id = "mock-scene-plan-compiler";

  async compile(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan> {
    options?.signal?.throwIfAborted();
    const [hookBeat, ...bodyBeats] = request.draft.beats;
    if (hookBeat?.beat !== "HOOK") throw new Error("The draft must open with a HOOK beat.");

    return {
      hook: {
        variant: "QUESTION",
        narration: hookBeat.narration.slice(0, 120),
        onScreenText: hookBeat.narration.slice(0, 60),
        visualVariant: "HOOK_QUESTION",
      },
      scenes: bodyBeats.map((beat) => {
        if (beat.beat === "HOOK") throw new Error("Only the first beat may be a HOOK.");
        return {
          type: SCENE_TYPE_FOR_BEAT[beat.beat],
          narration: beat.narration,
          onScreenText: beat.narration.slice(0, 120),
          visualVariant: "SCENARIO_CARD" as const,
        };
      }),
    };
  }
}
