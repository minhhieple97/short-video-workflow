import type { CharacterAction } from "@/features/videos/domain/illustration";
import { SCENE_TYPE_FOR_BEAT, type NarrativeBeat } from "@/features/videos/domain/narrative-beats";
import { mockPublishMetadata } from "@/server/ai/mock-publish-metadata";
import { mockShots } from "@/server/ai/mock-shots";
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
// whole story in one office, with the same shots the mock script gives each part.
export class MockScenePlanCompiler implements ScenePlanCompiler {
  readonly id = "mock-scene-plan-compiler";

  async compile(request: ScenePlanRequest, options?: CallOptions): Promise<ScenePlan> {
    options?.signal?.throwIfAborted();
    const [hookBeat, ...bodyBeats] = request.draft.beats;
    if (hookBeat?.beat !== "HOOK") throw new Error("The draft must open with a HOOK beat.");
    const hookNarration = hookBeat.narration.slice(0, 120);

    return {
      hook: {
        variant: "QUESTION",
        narration: hookNarration,
        onScreenText: hookBeat.narration.slice(0, 60),
        visualVariant: "HOOK_QUESTION",
        illustration: { setting: "OFFICE", action: ACTION_FOR_BEAT.HOOK },
      },
      scenes: bodyBeats.map((beat) => {
        if (beat.beat === "HOOK") throw new Error("Only the first beat may be a HOOK.");
        const type = SCENE_TYPE_FOR_BEAT[beat.beat];
        return {
          type,
          narration: beat.narration,
          onScreenText: beat.narration.slice(0, 120),
          visualVariant: "SCENARIO_CARD" as const,
          illustration: { setting: "OFFICE" as const, action: ACTION_FOR_BEAT[beat.beat] },
          shots: mockShots(type, beat.narration),
        };
      }),
      publish: mockPublishMetadata({ book: request.book, lessons: [request.lesson], hook: hookNarration }),
    };
  }
}
