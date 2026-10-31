import { describe, expect, it } from "vitest";

import { planSceneVisuals, transitionBetween, type SceneCut } from "@/remotion/timeline/scene-transitions";

const cut = (mode: "STAGE" | "TEXT", setting: string, durationInFrames: number): SceneCut => ({
  enter: { mode, setting },
  exit: { mode, setting },
  durationInFrames,
});

describe("scene transitions", () => {
  it("cuts straight within one place, wipes to a new place and slides text cards", () => {
    const edge = (mode: "STAGE" | "TEXT", setting: string) => ({ mode, setting });
    expect(transitionBetween(edge("STAGE", "HOME"), edge("STAGE", "HOME")).kind).toBe("none");
    expect(transitionBetween(edge("STAGE", "HOME"), edge("STAGE", "PARK")).kind).toBe("wipe");
    expect(transitionBetween(edge("STAGE", "HOME"), edge("TEXT", "HOME")).kind).toBe("slide");
    expect(transitionBetween(edge("TEXT", "HOME"), edge("TEXT", "HOME")).kind).toBe("fade");
  });

  it("joins a scene's last shot to the next scene's first shot", () => {
    const endsOnCard: SceneCut = {
      enter: { mode: "STAGE", setting: "HOME" },
      exit: { mode: "TEXT", setting: "HOME" },
      durationInFrames: 120,
    };
    const [first] = planSceneVisuals([endsOnCard, cut("STAGE", "HOME", 90)]);
    expect(first?.after.kind).toBe("slide");
    const leavesHome: SceneCut = {
      enter: { mode: "STAGE", setting: "HOME" },
      exit: { mode: "STAGE", setting: "PARK" },
      durationInFrames: 120,
    };
    expect(planSceneVisuals([leavesHome, cut("STAGE", "PARK", 90)])[0]?.after.kind).toBe("none");
  });

  it("starts every picture on its voice's first frame and keeps the video's length", () => {
    const scenes = [
      cut("STAGE", "HOME", 110),
      cut("STAGE", "PARK", 300),
      cut("TEXT", "PARK", 64),
      cut("STAGE", "PARK", 200),
      cut("STAGE", "PARK", 61),
    ];
    const plan = planSceneVisuals(scenes);
    let visualStart = 0;
    let voiceStart = 0;
    for (const [index, visual] of plan.entries()) {
      expect(visualStart).toBe(voiceStart);
      expect(visual.after.frames).toBeLessThanOrEqual(scenes[index]?.durationInFrames ?? 0);
      expect(visual.after.frames).toBeLessThanOrEqual(scenes[index + 1]?.durationInFrames ?? 0);
      visualStart += visual.durationInFrames - visual.after.frames;
      voiceStart += scenes[index]?.durationInFrames ?? 0;
    }
    const total = plan.reduce((sum, visual) => sum + visual.durationInFrames - visual.after.frames, 0);
    expect(total).toBe(scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0));
    expect(plan.at(-1)?.after.frames).toBe(0);
  });
});
