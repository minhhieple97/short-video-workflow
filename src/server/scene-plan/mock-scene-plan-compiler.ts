import type { CharacterAction } from "@/features/videos/domain/illustration";
import { SCENE_TYPE_FOR_BEAT, type NarrativeBeat } from "@/features/videos/domain/narrative-beats";
import { mockPublishMetadata } from "@/server/ai/mock-publish-metadata";
import { mockShots } from "@/server/ai/mock-shots";
import type { CallOptions } from "@/server/integrations/call-options";
import type { ScenePlan, ScenePlanCompiler, ScenePlanRequest } from "@/server/scene-plan/scene-plan-compiler";
import { validateStoryScenePlan } from "./story-scene-plan";

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
    if (request.story) {
      const story = request.story;
      const [first, ...beats] = story.draft.beats;
      if (!first) throw new Error("Missing hook.");
      const shotsFor = (beat: typeof first) => [
        {
          from: beat.narration.split(/\s+/).slice(0, 3).join(" "),
          setting: "OFFICE",
          actors: (beat.characterIds.length ? beat.characterIds : [story.cast.primaryCharacterId])
            .slice(0, 2)
            .map((characterId) => ({ characterId, action: ACTION_FOR_BEAT[beat.beat] })),
        },
      ];
      return validateStoryScenePlan(
        {
          schemaVersion: "story-scene-plan-v2",
          hook: { ...story.draft.hookOptions[0], shots: shotsFor(first) },
          scenes: beats.map((beat) => ({
            type: SCENE_TYPE_FOR_BEAT[beat.beat],
            narration: beat.narration,
            onScreenText: beat.narration.slice(0, 100),
            visualVariant: "SCENARIO_CARD",
            illustration: { setting: "OFFICE", action: ACTION_FOR_BEAT[beat.beat] },
            shots: shotsFor(beat),
          })),
          publish: mockPublishMetadata({ book: request.book, lessons: story.input.lessons, hook: first.narration }),
        },
        story,
      );
    }
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
