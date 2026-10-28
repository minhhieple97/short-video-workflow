import { describe, expect, it } from "vitest";

import {
  describeStoryOrderProblem,
  findNarrativeOrderProblem,
  findStorySceneOrderProblem,
  NARRATIVE_BEATS,
  STORY_SCENE_ORDER,
} from "@/features/videos/domain/narrative-beats";
import { scenePlanSchema } from "@/server/scene-plan/scene-plan-compiler";
import { scriptDraftSchema } from "@/server/script-studio/script-studio-contracts";

describe("narrative beat order", () => {
  it("accepts the full story in order", () => {
    expect(findNarrativeOrderProblem([...NARRATIVE_BEATS])).toBeNull();
  });

  it("allows a beat to repeat consecutively", () => {
    expect(
      findNarrativeOrderProblem(["HOOK", "SITUATION", "SITUATION", "MISTAKE", "LESSON", "RESOLUTION", "ACTION"]),
    ).toBeNull();
  });

  it("introduces the lesson only after the situation and the mistake", () => {
    expect(findNarrativeOrderProblem(["HOOK", "LESSON", "SITUATION", "MISTAKE", "RESOLUTION", "ACTION"])).toEqual({
      code: "OUT_OF_ORDER",
      item: "SITUATION",
      after: "LESSON",
    });
  });

  it("puts the lesson before the resolution that returns to the situation", () => {
    expect(findNarrativeOrderProblem(["HOOK", "SITUATION", "MISTAKE", "RESOLUTION", "LESSON", "ACTION"])).toEqual({
      code: "OUT_OF_ORDER",
      item: "LESSON",
      after: "RESOLUTION",
    });
  });

  it("requires a hook first and only one", () => {
    expect(findNarrativeOrderProblem(["SITUATION", "HOOK"])).toEqual({ code: "FIRST_BEAT_NOT_HOOK" });
    expect(findNarrativeOrderProblem(["HOOK", "SITUATION", "HOOK"])).toEqual({ code: "MULTIPLE_HOOKS" });
    expect(findNarrativeOrderProblem([])).toEqual({ code: "FIRST_BEAT_NOT_HOOK" });
  });

  it("requires every part of the story", () => {
    expect(findNarrativeOrderProblem(["HOOK", "SITUATION", "MISTAKE", "LESSON"])).toEqual({
      code: "MISSING",
      missing: ["RESOLUTION", "ACTION"],
    });
  });

  it("rejects a beat that is not part of the story", () => {
    expect(findNarrativeOrderProblem(["HOOK", "SITUATION", "BONUS"])).toEqual({ code: "UNKNOWN_ITEM", item: "BONUS" });
  });

  it("describes a problem in Vietnamese", () => {
    expect(describeStoryOrderProblem({ code: "MISSING", missing: ["ACTION"] })).toBe("Mạch kể còn thiếu: ACTION.");
  });
});

describe("story scene order", () => {
  it("accepts the five story scenes in order", () => {
    expect(findStorySceneOrderProblem([...STORY_SCENE_ORDER])).toBeNull();
  });

  it("rejects the manual flow's order, which puts the better approach before the takeaway", () => {
    expect(
      findStorySceneOrderProblem(["SITUATION", "COMMON_MISTAKE", "BETTER_APPROACH", "KEY_TAKEAWAY", "ACTION_STEP"]),
    ).toEqual({ code: "OUT_OF_ORDER", item: "KEY_TAKEAWAY", after: "BETTER_APPROACH" });
  });

  it("rejects a scene type outside the story, such as SUMMARY", () => {
    expect(findStorySceneOrderProblem([...STORY_SCENE_ORDER, "SUMMARY"])).toEqual({
      code: "UNKNOWN_ITEM",
      item: "SUMMARY",
    });
  });

  it("requires every story scene", () => {
    expect(findStorySceneOrderProblem(["SITUATION", "COMMON_MISTAKE", "KEY_TAKEAWAY", "BETTER_APPROACH"])).toEqual({
      code: "MISSING",
      missing: ["ACTION_STEP"],
    });
  });
});

describe("contracts enforce the story", () => {
  const beat = (name: string) => ({ beat: name, narration: "Lời dẫn.", sourceExcerpts: [], illustrative: false });

  it("rejects a script draft whose beats are out of order", () => {
    const draft = {
      lessonId: "l",
      beats: ["HOOK", "SITUATION", "MISTAKE", "RESOLUTION", "LESSON", "ACTION"].map(beat),
    };

    const result = scriptDraftSchema.safeParse(draft);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("giải pháp đến sau bài học");
  });

  it("accepts a script draft that tells the whole story", () => {
    expect(scriptDraftSchema.safeParse({ lessonId: "l", beats: NARRATIVE_BEATS.map(beat) }).success).toBe(true);
  });

  it("rejects a scene plan in the manual flow's order", () => {
    const scene = (type: string) => ({ type, narration: "Lời.", onScreenText: "Chữ", visualVariant: "SCENARIO_CARD" });
    const hook = { variant: "QUESTION", narration: "Hook?", onScreenText: "Hook?", visualVariant: "HOOK_QUESTION" };

    expect(
      scenePlanSchema.safeParse({
        hook,
        scenes: ["SITUATION", "COMMON_MISTAKE", "BETTER_APPROACH", "KEY_TAKEAWAY", "ACTION_STEP"].map(scene),
      }).success,
    ).toBe(false);
    expect(scenePlanSchema.safeParse({ hook, scenes: STORY_SCENE_ORDER.map(scene) }).success).toBe(true);
  });
});
