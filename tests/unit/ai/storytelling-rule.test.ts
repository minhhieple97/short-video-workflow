import { describe, expect, it } from "vitest";

import { STORY_ANGLE_LABELS, STORY_ANGLES } from "@/features/videos/domain/story-angle";
import {
  SCENE_EDIT_RULE,
  STORY_REWRITE_RULE,
  STORYTELLING_RULE,
  storyAngleRule,
} from "@/server/ai/prompts/storytelling-rule";

const BANNED_OPENINGS = ["Có phải bạn…", "Bạn có biết…", "Tại sao bạn luôn…", "Hãy tưởng tượng…"];

describe("the shared storytelling rules", () => {
  it("ask for a concrete moment instead of the opening questions every video used to start with", () => {
    for (const opening of BANNED_OPENINGS) expect(STORYTELLING_RULE).toContain(`“${opening}”`);
    expect(STORYTELLING_RULE).toContain("mở giữa một khoảnh khắc cụ thể");
    expect(STORYTELLING_RULE).toContain("lời hứa ấy được trả ở phần cách giải quyết");
  });

  it("ask for named people, visible details, a price for the mistake and a turn before the lesson", () => {
    expect(STORYTELLING_RULE).toContain("nhân vật có tên");
    expect(STORYTELLING_RULE).toContain("không bằng tính từ");
    expect(STORYTELLING_RULE).toContain("Sai lầm có cái giá");
    expect(STORYTELLING_RULE).toContain("tưởng là A, hoá ra là B");
  });

  it("limit dialogue to the characters the model makes up, and keep the author's words verbatim and in the sources", () => {
    expect(STORYTELLING_RULE).toContain("trong “ngoặc kép”, chỉ của nhân vật tự nghĩ ra");
    expect(STORYTELLING_RULE).toContain("chỉ được nhắc khi là câu nguyên văn trong nguồn");
  });

  it("keep the made-up story honest: illustrative, never the author's, never a true story, never an invented fact", () => {
    expect(STORYTELLING_RULE).toContain("là tình huống minh hoạ");
    expect(STORYTELLING_RULE).toContain("không gắn chúng cho tác giả hay cuốn sách");
    expect(STORYTELLING_RULE).toContain("không nói đó là chuyện có thật");
    expect(STORYTELLING_RULE).toContain("không kể ngôi “tôi” như trải nghiệm của người làm video");
    expect(STORYTELLING_RULE).toContain("không bịa số liệu, nghiên cứu hay trích dẫn");
  });

  it("stay short enough to share a question with the lesson and the sources", () => {
    expect(STORYTELLING_RULE.length).toBeLessThanOrEqual(2_400);
    expect(STORY_REWRITE_RULE.length).toBeLessThanOrEqual(500);
    expect(SCENE_EDIT_RULE.length).toBeLessThanOrEqual(1_100);
  });

  it("keep a rewritten scene's people and lines, and never open it with a stock question", () => {
    expect(STORY_REWRITE_RULE).toContain("giữ nhân vật, tên và câu thoại đã có");
    expect(STORY_REWRITE_RULE).toContain("không mở bằng khuôn “Có phải bạn…”");
  });
});

describe("story angle rules", () => {
  it("name the angle in Vietnamese and keep the six-part frame, whichever angle is given", () => {
    for (const angle of STORY_ANGLES) {
      const rule = storyAngleRule(angle);

      expect(rule).toContain(`“${STORY_ANGLE_LABELS[angle]}”`);
      expect(rule).toContain("Vẫn đủ sáu phần theo đúng thứ tự");
      expect(rule).toContain("không cho thêm ý ngoài nguồn");
    }
  });

  it("describe how the hook, the situation, the mistake and the resolution are told, for every angle", () => {
    for (const angle of STORY_ANGLES) {
      const rule = storyAngleRule(angle).toLowerCase();

      for (const part of ["hook", "tình huống", "sai lầm", "cách giải quyết"]) {
        expect(rule, `${angle} should mention ${part}`).toContain(part);
      }
    }
  });

  it("are different from each other, and each stays short", () => {
    const rules = STORY_ANGLES.map(storyAngleRule);

    expect(new Set(rules).size).toBe(STORY_ANGLES.length);
    for (const rule of rules) expect(rule.length).toBeLessThanOrEqual(800);
  });

  it("do not tell the model to name the book before the lesson, or to claim a research", () => {
    for (const angle of STORY_ANGLES) {
      expect(storyAngleRule(angle)).not.toMatch(/tên sách|cuốn sách/i);
    }
    expect(storyAngleRule("MYTH_BUST")).toContain("không gắn cho “nghiên cứu cho thấy”");
  });
});
