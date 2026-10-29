import { describe, expect, it } from "vitest";

import { estimateNarrationSeconds, fitToRange } from "@/features/videos/domain/duration";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

import {
  describeScriptStudioProviderContract,
  SAMPLE_LESSON,
} from "../../helpers/contracts/script-studio-provider-contract";

describeScriptStudioProviderContract("MockScriptStudioProvider", () => new MockScriptStudioProvider());

describe("MockScriptStudioProvider", () => {
  it("writes about as much as the length it proposes, telling short lesson fields again to reach the minimum", async () => {
    const terse = "Ngắn.";
    const lesson = {
      ...SAMPLE_LESSON,
      realLifeScenario: terse,
      commonMistake: terse,
      principle: terse,
      betterApproach: terse,
      actionableStep: terse,
      summary: "Một câu tóm tắt đủ dài để kể lại nhiều lần trong cùng một video.",
    };
    const range = { minDurationSec: 45, maxDurationSec: 90 };

    const draft = await new MockScriptStudioProvider().writeDraft({
      sources: [],
      lesson,
      range,
      pace: "STANDARD",
      storyAngle: "PEAK_FIRST",
      revisionNote: null,
    });
    const seconds = draft.beats.reduce((sum, beat) => sum + estimateNarrationSeconds(beat.narration), 0);

    expect(seconds).toBeGreaterThanOrEqual(45);
    expect(draft.targetDurationSec).toBe(fitToRange(seconds, range));
  });
});
