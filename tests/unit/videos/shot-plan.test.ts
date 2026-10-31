import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  aiShotListSchema,
  aiShotTexts,
  maxShotsFor,
  parseShotPlan,
  planShots,
  rebaseShotPlan,
  serializeShotPlan,
  shotPlanProblem,
  shotPlanSchema,
  shotTexts,
  type AiShot,
} from "@/features/videos/domain/shot-plan";
import { sceneContentHash } from "@/features/videos/services/scene-records";
import { TASK_OUTPUT_SCHEMAS } from "@/server/ai/cli-task/task-files";

const NARRATION =
  "Minh hứa sẽ đọc sách mỗi tối. Nhưng mười một giờ đêm, anh vẫn lướt điện thoại, rồi lại hứa mai sẽ đọc.";

describe("planning a model's shots on the narration's words", () => {
  it("starts the first shot on the first word and each later one on the words it quotes", () => {
    const plan = planShots(NARRATION, [
      { setting: "HOME", action: "PHONE" },
      { from: "Nhưng mười một giờ", mood: "TIRED" },
      { from: "rồi lại hứa", size: "CLOSE" },
    ]);
    expect(plan?.map((shot) => shot.fromWord)).toEqual([0, 7, 17]);
    expect(plan?.[1]).toEqual({ fromWord: 7, mood: "TIRED" });
  });

  it("finds a repeated word after the previous cue, not its first use", () => {
    const plan = planShots(NARRATION, [{}, { from: "đọc" }]);
    expect(plan?.[1]?.fromWord).toBe(3);
    const later = planShots(NARRATION, [{}, { from: "Nhưng" }, { from: "đọc" }]);
    expect(later?.map((shot) => shot.fromWord)).toEqual([0, 7, 22]);
  });

  it("lands a cue whose later words were reworded on its first ones, ignoring case and punctuation", () => {
    expect(planShots(NARRATION, [{}, { from: "NHƯNG, mười hai giờ" }])?.[1]?.fromWord).toBe(7);
  });

  it("spreads cues it cannot find evenly and drops shots that no longer fit the words", () => {
    const plan = planShots(NARRATION, [{}, { from: "không có trong lời" }, { from: "rồi lại hứa" }]);
    expect(plan?.map((shot) => shot.fromWord)).toEqual([0, 9, 17]);
    expect(planShots("Hai chữ", [{}, { from: "x" }, { from: "y" }, { from: "z" }])?.length).toBe(2);
    expect(planShots("", [{}])).toBeNull();
    expect(planShots(NARRATION, undefined)).toBeNull();
  });

  it("keeps no more shots than the scene allows", () => {
    const many: AiShot[] = Array.from({ length: 9 }, (_, index) => ({ from: NARRATION.split(" ")[index * 2] }));
    expect(planShots(NARRATION, many)?.length).toBe(maxShotsFor("SITUATION"));
    expect(planShots(NARRATION, many, maxShotsFor("HOOK"))?.length).toBe(2);
  });

  it("keeps a card that fits its style, turns a misfit into a punchline and drops one that fits nothing", () => {
    const [versus, number, quote, tooLong] = [
      { card: { style: "VERSUS" as const, lines: ["Cố làm hết một đêm"] } },
      { card: { style: "NUMBER" as const, lines: ["Rất nhiều", "lần"] } },
      { card: { style: "QUOTE" as const, lines: ["Một câu", "tách đôi."] } },
      { card: { style: "LIST" as const, lines: ["x".repeat(41), "y"] } },
    ].map((shot) => planShots(NARRATION, [shot])?.[0]?.card);
    expect(versus).toEqual({ style: "PUNCH", lines: ["Cố làm hết một đêm"] });
    expect(number).toEqual({ style: "PUNCH", lines: ["Rất nhiều", "lần"] });
    expect(quote).toEqual({ style: "QUOTE", lines: ["Một câu tách đôi."] });
    expect(tooLong).toBeUndefined();
  });
});

describe("a stored shot plan", () => {
  const plan = planShots(NARRATION, [
    { setting: "HOME", props: [{ id: "MOBILE_PHONE", label: "3 tiếng" }, { id: "MOBILE_PHONE" }] },
    { from: "Nhưng mười một giờ", tag: "23:00", card: { style: "NUMBER", lines: ["23:00", "vẫn lướt"] } },
  ]);

  it("is valid, deduplicated and serialised the same way whatever the key order", () => {
    expect(shotPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan?.[0]?.props).toEqual([{ id: "MOBILE_PHONE", label: "3 tiếng" }]);
    const reordered = plan?.map((shot) => Object.fromEntries(Object.entries(shot).reverse()));
    expect(serializeShotPlan(shotPlanSchema.parse(reordered))).toBe(serializeShotPlan(plan ?? []));
    expect(parseShotPlan(serializeShotPlan(plan ?? []))).toEqual(plan);
  });

  it("rejects a plan that does not start on the first word or goes backwards", () => {
    expect(shotPlanSchema.safeParse([{ fromWord: 2 }]).success).toBe(false);
    expect(shotPlanSchema.safeParse([{ fromWord: 0 }, { fromWord: 5 }, { fromWord: 5 }]).success).toBe(false);
    expect(parseShotPlan("not json")).toBeNull();
  });

  it("must fit its scene's words and the scene's shot limit", () => {
    expect(shotPlanProblem([{ fromWord: 0 }, { fromWord: 40 }], NARRATION, "SITUATION")).toMatch(/ngoài lời dẫn/);
    expect(shotPlanProblem([{ fromWord: 0 }, { fromWord: 3 }, { fromWord: 6 }], NARRATION, "HOOK")).toMatch(/tối đa 2/);
    expect(shotPlanProblem(plan ?? [], NARRATION, "SITUATION")).toBeNull();
  });

  it("follows its words when the narration is rewritten", () => {
    const rewritten = "Tối nào Minh cũng hứa đọc sách. Nhưng mười một giờ đêm, điện thoại vẫn sáng.";
    expect(rebaseShotPlan(plan ?? [], NARRATION, rewritten)?.map((shot) => shot.fromWord)).toEqual([0, 7]);
    expect(rebaseShotPlan(plan ?? [], NARRATION, NARRATION)).toBe(plan);
  });

  it("counts towards the scene's hash only when there is one, so older scenes keep theirs", () => {
    const content = {
      type: "SITUATION",
      narration: NARRATION,
      onScreenText: "Hứa rồi lại lướt",
      visualVariant: "SCENARIO_CARD",
    };
    const legacy = sceneContentHash(content);
    expect(sceneContentHash({ ...content, shots: null })).toBe(legacy);
    expect(sceneContentHash({ ...content, shots: plan })).not.toBe(legacy);
  });

  it("puts its words up for the source check, a quote card as a quotation", () => {
    const texts = shotTexts([
      { fromWord: 0, tag: "Ngày 3", props: [{ id: "BOOKS", label: "2 trang" }] },
      { fromWord: 4, card: { style: "QUOTE", lines: ["Hệ thống thắng mục tiêu."] } },
    ]);
    expect(texts).toEqual(expect.arrayContaining(["Ngày 3", "2 trang", "“Hệ thống thắng mục tiêu.”"]));
    expect(aiShotTexts([{ from: "x", tag: "Ngày 7" }])).toContain("Ngày 7");
  });
});

describe("the shots a model writes", () => {
  const schema = aiShotListSchema(6);

  it("drops a broken field on its own instead of failing the script, and reads the same twice", () => {
    const parsed = schema.parse([
      { setting: "MOON", action: "PHONE", props: [{ id: "A" }, { id: "B" }, { id: "C" }] },
      { from: "x", mood: "TIRED", tag: "t".repeat(40), card: { style: "LIST", lines: [] } },
    ]);
    expect(parsed).toEqual([{ action: "PHONE" }, { from: "x", mood: "TIRED" }]);
    expect(schema.parse(parsed)).toEqual(parsed);
    expect(schema.parse("not a list")).toBeUndefined();
  });

  it("converts to the JSON Schema the Claude CLI is given, for every task output", () => {
    for (const output of Object.values(TASK_OUTPUT_SCHEMAS)) {
      expect(() => z.toJSONSchema(output, { target: "draft-7" })).not.toThrow();
    }
    const script = JSON.stringify(z.toJSONSchema(TASK_OUTPUT_SCHEMAS["video-script"], { target: "draft-7" }));
    expect(script).toContain('"shots"');
    const rewrite = JSON.stringify(z.toJSONSchema(TASK_OUTPUT_SCHEMAS["scene-regeneration"], { target: "draft-7" }));
    expect(rewrite).not.toContain('"shots"');
  });
});
