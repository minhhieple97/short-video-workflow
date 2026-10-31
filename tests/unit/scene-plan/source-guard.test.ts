import { describe, expect, it } from "vitest";

import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type { ScenePlan } from "@/server/scene-plan/scene-plan-compiler";
import { findUnsupportedClaims, hasUnsupportedClaims } from "@/server/scene-plan/source-guard";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import { SAMPLE_LESSON } from "../../helpers/contracts/script-studio-provider-contract";

const beat = (name: ScriptDraft["beats"][number]["beat"], narration: string, excerpts: string[] = []) => ({
  beat: name,
  narration,
  sourceExcerpts: excerpts.map((text) => ({ page: 3, text })),
  illustrative: false,
});

const DRAFT: ScriptDraft = {
  lessonId: "lesson-1",
  targetDurationSec: 60,
  durationReason: "Đủ kể trọn bài học.",
  beats: [
    beat("HOOK", "Vì sao bạn hoãn việc?"),
    beat("SITUATION", "Tối nào bạn cũng định tập."),
    beat("MISTAKE", "Bạn đặt mục tiêu quá lớn."),
    beat("LESSON", "Sách nói: “bắt đầu bằng hai phút đầu tiên”.", [
      "Hãy bắt đầu bằng hai phút đầu tiên của việc cần làm.",
    ]),
    beat("RESOLUTION", "Quay lại tối nay: mang giày vào."),
    beat("ACTION", "Làm ngay hai phút đầu."),
  ],
};

const LESSON: LessonSnapshot = { ...SAMPLE_LESSON, principle: "Quy tắc 2 phút và tỷ lệ 3,5." };

function planWith(overrides: { hook?: string; scene?: string; onScreen?: string } = {}): ScenePlan {
  const scene = (type: string, narration: string, onScreenText = "Chữ") => ({
    type,
    narration,
    onScreenText,
    visualVariant: "SCENARIO_CARD",
  });
  return {
    hook: {
      variant: "QUESTION",
      narration: overrides.hook ?? "Vì sao bạn hoãn việc?",
      onScreenText: "Vì sao?",
      visualVariant: "HOOK_QUESTION",
    },
    scenes: [
      scene("SITUATION", "Tối nào bạn cũng định tập.", overrides.onScreen),
      scene("COMMON_MISTAKE", "Bạn đặt mục tiêu quá lớn."),
      scene("KEY_TAKEAWAY", overrides.scene ?? "Sách gợi ý bắt đầu nhỏ."),
      scene("BETTER_APPROACH", "Quay lại tối nay: mang giày vào."),
      scene("ACTION_STEP", "Làm ngay hai phút đầu."),
    ],
  } as ScenePlan;
}

describe("findUnsupportedClaims", () => {
  it("checks the words a plan's shots put on screen like its narration", () => {
    const plan = planWith();
    const withShots = (shots: unknown[]) =>
      ({
        ...plan,
        scenes: plan.scenes.map((scene, index) => (index === 2 ? { ...scene, shots } : scene)),
      }) as ScenePlan;

    const faithful = withShots([
      { card: { style: "QUOTE", lines: ["Hãy bắt đầu bằng hai phút đầu tiên của việc cần làm."] } },
      { from: "bắt đầu", tag: "2 phút" },
    ]);
    expect(hasUnsupportedClaims(findUnsupportedClaims(faithful, DRAFT, LESSON))).toBe(false);

    const invented = withShots([
      { card: { style: "QUOTE", lines: ["Thành công là 99% mồ hôi."] } },
      { from: "bắt đầu", props: [{ id: "CHART_UP", label: "Tăng 40%" }] },
    ]);
    expect(findUnsupportedClaims(invented, DRAFT, LESSON)).toEqual({
      numbers: ["99", "40"],
      quotes: ["Thành công là 99% mồ hôi."],
    });
  });

  it("accepts a plan that only rewords what the draft and lesson say", () => {
    const claims = findUnsupportedClaims(planWith(), DRAFT, LESSON);

    expect(claims).toEqual({ numbers: [], quotes: [] });
    expect(hasUnsupportedClaims(claims)).toBe(false);
  });

  it("flags a number that is in neither the draft nor the lesson, wherever it appears", () => {
    expect(
      findUnsupportedClaims(planWith({ scene: "73% người bỏ cuộc sau một tuần." }), DRAFT, LESSON).numbers,
    ).toEqual(["73"]);
    expect(findUnsupportedClaims(planWith({ hook: "Chỉ 5 người làm được." }), DRAFT, LESSON).numbers).toEqual(["5"]);
    expect(findUnsupportedClaims(planWith({ onScreen: "Top 10" }), DRAFT, LESSON).numbers).toEqual(["10"]);
  });

  it("allows a number that the lesson itself contains, with a decimal comma or point alike", () => {
    expect(findUnsupportedClaims(planWith({ scene: "Quy tắc 2 phút, tỷ lệ 3.5." }), DRAFT, LESSON).numbers).toEqual([]);
    expect(findUnsupportedClaims(planWith({ scene: "Tỷ lệ 3,5." }), DRAFT, LESSON).numbers).toEqual([]);
  });

  it("flags a quotation that is not in the source, with straight or curly marks", () => {
    const made = findUnsupportedClaims(planWith({ scene: 'Tác giả viết: "mọi việc đều dễ dàng".' }), DRAFT, LESSON);
    const curly = findUnsupportedClaims(planWith({ scene: "Tác giả viết: “hãy nghỉ ngơi nhiều hơn”." }), DRAFT, LESSON);

    expect(made.quotes).toEqual(["mọi việc đều dễ dàng"]);
    expect(curly.quotes).toEqual(["hãy nghỉ ngơi nhiều hơn"]);
  });

  it("allows a quotation that appears in a source excerpt, ignoring case, spacing and composed form", () => {
    const decomposed = "BẮT  ĐẦU bằng hai phút đầu tiên".normalize("NFD");

    expect(findUnsupportedClaims(planWith({ scene: `Sách nói “${decomposed}”.` }), DRAFT, LESSON).quotes).toEqual([]);
  });

  it("accepts a quotation that differs from its source only by punctuation or marks, so a changed comma is not a made-up line", () => {
    const quoted = (text: string) =>
      findUnsupportedClaims(planWith({ scene: `Sách nói “${text}”.` }), DRAFT, LESSON).quotes;

    expect(quoted("Bắt đầu, bằng hai phút đầu tiên!")).toEqual([]);
    expect(quoted("bắt đầu bằng hai phút đầu tiên…")).toEqual([]);
    expect(quoted("bắt đầu - bằng hai phút (đầu tiên)")).toEqual([]);
  });

  it("keeps a line of dialogue the draft wrote, however the plan punctuates or places it", () => {
    const dialogueDraft: ScriptDraft = {
      ...DRAFT,
      beats: DRAFT.beats.map((item) =>
        item.beat === "SITUATION" ? { ...item, narration: "“Mai làm tiếp nhé,” Hà nói. Rồi cô tắt đèn." } : item,
      ),
    };

    expect(
      findUnsupportedClaims(planWith({ scene: "Hà nói: “Mai làm tiếp nhé.”" }), dialogueDraft, LESSON).quotes,
    ).toEqual([]);
  });

  it("still flags a quotation whose words are not in the sources, punctuation aside", () => {
    expect(
      findUnsupportedClaims(planWith({ scene: "Sách nói “bắt đầu bằng ba phút đầu tiên!”." }), DRAFT, LESSON).quotes,
    ).toEqual(["bắt đầu bằng ba phút đầu tiên!"]);
    expect(findUnsupportedClaims(planWith({ scene: "Hà nói: “Mai ta làm tiếp nhé.”" }), DRAFT, LESSON).quotes).toEqual([
      "Mai ta làm tiếp nhé.",
    ]);
  });

  it("ignores very short quoted words that are not quotations", () => {
    expect(findUnsupportedClaims(planWith({ scene: 'Gọi nó là "ok" thôi.' }), DRAFT, LESSON).quotes).toEqual([]);
  });

  it("reports each offending number and quotation once", () => {
    const claims = findUnsupportedClaims(
      planWith({ scene: "99 và 99 lần, “câu bịa đặt”, “câu bịa đặt”." }),
      DRAFT,
      LESSON,
    );

    expect(claims).toEqual({ numbers: ["99"], quotes: ["câu bịa đặt"] });
  });
});
