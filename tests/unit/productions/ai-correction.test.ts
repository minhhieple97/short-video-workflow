import { describe, expect, it } from "vitest";

import { planCorrection } from "@/features/productions/domain/ai-correction";

const issue = (code: string, message?: string) => ({ code, message });

describe("planCorrection", () => {
  it.each(["SOURCE_MISSING", "DRAFT_INVALID"])(
    "sends %s, a content or source problem, to the script studio",
    (code) => {
      expect(planCorrection([issue(code)])).toMatchObject({ target: "SCRIPT_STUDIO", rewindTo: "NONE" });
    },
  );

  it.each([
    "OVER_TARGET",
    "OVER_MAX",
    "HOOK_TOO_LONG",
    "HOOK_MISSING",
    "NO_SCENES",
    "EMPTY_TEXT",
    "INVALID_AI_OUTPUT",
    "SCENE_PLAN_UNSUPPORTED_CLAIM",
  ])("sends %s, a compile or length problem, to the scene compiler", (code) => {
    expect(planCorrection([issue(code)])).toMatchObject({ target: "SCENE_COMPILER", rewindTo: "DRAFTED" });
  });

  it("offers nothing for problems an AI cannot repair, and never for an empty list", () => {
    expect(planCorrection([issue("AUDIO_NOT_READY"), issue("SCRIPT_CHANGED"), issue("SOMETHING_NEW")])).toBeNull();
    expect(planCorrection([])).toBeNull();
  });

  it("ignores the unfixable problems when a fixable one is present", () => {
    expect(planCorrection([issue("AUDIO_NOT_READY"), issue("OVER_TARGET")])).toMatchObject({
      target: "SCENE_COMPILER",
    });
  });

  it("goes to the earlier step when both kinds of problem exist, and the note still covers both", () => {
    const plan = planCorrection([issue("OVER_TARGET"), issue("SOURCE_MISSING")]);

    expect(plan?.target).toBe("SCRIPT_STUDIO");
    expect(plan?.note).toContain("rút gọn lời dẫn");
    expect(plan?.note).toContain("trích đoạn nguồn");
  });

  it("tells the AI to shorten rather than to raise the preset or speed the narration up", () => {
    const note = planCorrection([issue("OVER_TARGET")])?.note ?? "";

    expect(note).toContain("không tăng preset");
    expect(note).toContain("không đọc nhanh hơn");
  });

  it("states the hook limit from the shared constant", () => {
    expect(planCorrection([issue("HOOK_TOO_LONG")])?.note).toContain("quá 4 giây");
  });

  it("repeats nothing and stays short", () => {
    const note =
      planCorrection([issue("OVER_TARGET"), issue("OVER_TARGET"), issue("EMPTY_TEXT"), issue("OVER_MAX")])?.note ?? "";

    expect(note.match(/vượt preset/g)).toHaveLength(1);
    expect(note.length).toBeLessThanOrEqual(600);
  });

  it("does not treat a warning-level code such as LONG_TEXT as something to correct", () => {
    expect(planCorrection([issue("LONG_TEXT", "chữ dài")])).toBeNull();
  });
});
