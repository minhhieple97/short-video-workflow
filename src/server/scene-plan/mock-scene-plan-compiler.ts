import type { CharacterAction } from "@/features/videos/domain/illustration";
import { SCENE_TYPE_FOR_BEAT, type NarrativeBeat } from "@/features/videos/domain/narrative-beats";
import type { CallOptions } from "@/server/integrations/call-options";
import type { ScenePlan, ScenePlanCompiler, ScenePlanRequest } from "@/server/scene-plan/scene-plan-compiler";

const ACTION_FOR_BEAT: Record<NarrativeBeat, CharacterAction> = {
  HOOK: "THINKING",
  SITUATION: "PHONE",
  MISTAKE: "WORRIED",
  LESSON: "IDEA",
  RESOLUTION: "TALKING",
  ACTION: "WORKING",
};

// Deterministic and offline (AI_MODE=mock): turns each draft beat into its scene without rewording anything, the
// whole story in one office.
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
        illustration: { setting: "OFFICE", action: ACTION_FOR_BEAT.HOOK },
      },
      scenes: bodyBeats.map((beat) => {
        if (beat.beat === "HOOK") throw new Error("Only the first beat may be a HOOK.");
        return {
          type: SCENE_TYPE_FOR_BEAT[beat.beat],
          narration: beat.narration,
          onScreenText: beat.narration.slice(0, 120),
          visualVariant: "SCENARIO_CARD" as const,
          illustration: { setting: "OFFICE" as const, action: ACTION_FOR_BEAT[beat.beat] },
        };
      }),
    };
  }
}
