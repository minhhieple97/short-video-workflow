import { describe, expect, it } from "vitest";

import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";
import { scenePlanSchema, type ScenePlanCompiler } from "@/server/scene-plan/scene-plan-compiler";

import { SAMPLE_LESSON } from "./script-studio-provider-contract";

const DRAFT: ScriptDraft = {
  lessonId: SAMPLE_LESSON.lessonId,
  targetDurationSec: 60,
  durationReason: "Đủ kể trọn bài học.",
  beats: [
    { beat: "HOOK", narration: "Vì sao bạn cứ hẹn ngày mai?", sourceExcerpts: [], illustrative: false },
    {
      beat: "SITUATION",
      narration: "Tối nào bạn cũng định tập nhưng lại thôi.",
      sourceExcerpts: [],
      illustrative: true,
    },
    { beat: "MISTAKE", narration: "Bạn đặt mục tiêu quá lớn.", sourceExcerpts: [], illustrative: false },
    {
      beat: "LESSON",
      narration: "Sách gợi ý bắt đầu bằng hai phút.",
      sourceExcerpts: [{ page: 12, text: "Hãy bắt đầu nhỏ." }],
      illustrative: false,
    },
    { beat: "RESOLUTION", narration: "Quay lại tối nay: chỉ mang giày vào.", sourceExcerpts: [], illustrative: false },
    { beat: "ACTION", narration: "Làm ngay hai phút đầu tiên.", sourceExcerpts: [], illustrative: false },
  ],
};

export function describeScenePlanCompilerContract(name: string, createCompiler: () => ScenePlanCompiler): void {
  describe(`ScenePlanCompiler contract: ${name}`, () => {
    const request = {
      draft: DRAFT,
      lesson: SAMPLE_LESSON,
      targetDurationSec: 60 as const,
      range: { minDurationSec: 30, maxDurationSec: 60 },
      revisionNote: null,
    };

    it("returns a plan that satisfies the scene-plan contract", async () => {
      const plan = await createCompiler().compile(request);

      expect(scenePlanSchema.safeParse(plan).success).toBe(true);
    });

    it("keeps the draft's story order in the compiled scenes", async () => {
      const plan = await createCompiler().compile(request);

      expect(plan.scenes.map((scene) => scene.type)).toEqual([
        "SITUATION",
        "COMMON_MISTAKE",
        "KEY_TAKEAWAY",
        "BETTER_APPROACH",
        "ACTION_STEP",
      ]);
    });

    it("accepts a revision note on the correction pass", async () => {
      const plan = await createCompiler().compile({ ...request, revisionNote: "Rút gọn để vừa 60 giây." });

      expect(scenePlanSchema.safeParse(plan).success).toBe(true);
    });

    it("rejects when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(createCompiler().compile(request, { signal: controller.signal })).rejects.toThrow();
    });
  });
}
