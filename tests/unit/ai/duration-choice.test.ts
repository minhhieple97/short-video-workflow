import { describe, expect, it } from "vitest";

import type { Pace } from "@/features/videos/domain/pace";
import { durationChoices, narrationBudget, NARRATION_BUDGET_RULE } from "@/server/ai/prompts/duration-choice";
import { buildScenePlanPrompt, SCENE_PLAN_PROMPT_VERSION } from "@/server/ai/prompts/scene-plan-prompt";
import { buildVideoScriptPrompt, VIDEO_SCRIPT_PROMPT_VERSION } from "@/server/ai/prompts/video-script-prompt";
import { DRAFT_PERSONA } from "@/server/script-studio/notebooklm/prompts/chat-persona-prompt";
import { buildScriptDraftPrompt } from "@/server/script-studio/notebooklm/prompts/script-draft-prompt";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import { SAMPLE_BOOK, SAMPLE_LESSON } from "../../helpers/contracts/script-studio-provider-contract";

const range = { minDurationSec: 60, maxDurationSec: 90 } as const;
const budgets: { pace: Pace; seconds: 60 | 90; units: number }[] = [
  { pace: "STANDARD", seconds: 60, units: 216 },
  { pace: "STANDARD", seconds: 90, units: 324 },
  { pace: "FAST", seconds: 60, units: 248 },
  { pace: "FAST", seconds: 90, units: 372 },
  { pace: "FASTER", seconds: 60, units: 280 },
  { pace: "FASTER", seconds: 90, units: 421 },
];

describe("narration planning budgets", () => {
  it.each(budgets)(
    "keeps the same headroom in all writing stages at $seconds seconds and $pace",
    ({ pace, seconds, units }) => {
      const draft: ScriptDraft = {
        lessonId: SAMPLE_LESSON.lessonId,
        targetDurationSec: seconds,
        durationReason: "Kể đủ nguyên lý và lựa chọn.",
        beats: [],
      };
      const notebook = buildScriptDraftPrompt({
        lesson: SAMPLE_LESSON,
        range,
        pace,
        storyAngle: "DIALOGUE",
        revisionNote: null,
      });
      const compiler = buildScenePlanPrompt({
        draft,
        lesson: SAMPLE_LESSON,
        book: SAMPLE_BOOK,
        targetDurationSec: seconds,
        ...range,
        pace,
        revisionNote: null,
        promptVersion: SCENE_PLAN_PROMPT_VERSION,
      });
      const manual = buildVideoScriptPrompt({
        videoId: "video-1",
        title: SAMPLE_LESSON.title,
        ...range,
        pace,
        storyAngle: "DIALOGUE",
        videoProfile: "SHORT_VERTICAL",
        book: SAMPLE_BOOK,
        lessons: [SAMPLE_LESSON],
        promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
      });

      expect(narrationBudget(seconds, pace)).toBe(units);
      expect(notebook).toContain(`${seconds} (${seconds} giây) ≈ ${units} từ`);
      expect(compiler).toContain(`khoảng ~${units} âm tiết`);
      expect(manual).toContain(`${seconds} (${seconds} giây) ≈ ${units} âm tiết`);
      // The notebook stage reads its standing rules (the notebook's chat persona) together with the question; the others one prompt.
      for (const prompt of [`${DRAFT_PERSONA.prompt}\n${notebook}`, compiler, manual]) {
        expect(prompt).toContain(NARRATION_BUDGET_RULE);
        expect(prompt).not.toContain("không dưới ~");
      }
    },
  );

  it("offers only the existing presets inside the range, rather than adding a soft duration target", () => {
    expect(durationChoices(range, "STANDARD", "từ")).toBe("60 (60 giây) ≈ 216 từ; 90 (90 giây) ≈ 324 từ");
    expect(durationChoices({ minDurationSec: 60, maxDurationSec: 60 }, "STANDARD", "từ")).toBe("60 (60 giây) ≈ 216 từ");
  });

  it("does not mistake conservative narration at the minimum target for a measured minimum duration", () => {
    expect(narrationBudget(60, "STANDARD") / 4).toBe(54);
    expect(NARRATION_BUDGET_RULE).toContain("sát mức tối thiểu vẫn có thể thiếu");
    expect(NARRATION_BUDGET_RULE).toContain("audio đo được cộng đệm từng cảnh");
    expect(NARRATION_BUDGET_RULE).toContain("Không tự đổi nhịp hay khoảng");
  });
});
