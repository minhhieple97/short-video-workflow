import { describe, expect, it } from "vitest";

import {
  assessDurationBudget,
  assessLessonLoad,
  clampToRange,
  fitToRange,
  formatRange,
  isWithinRange,
  presetsInRange,
  countSyllables,
  estimateNarrationSeconds,
  HOOK_MAX_SECONDS,
} from "@/features/videos/domain/duration";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { findStorySceneOrderProblem } from "@/features/videos/domain/narrative-beats";
import { acceptPublishMetadata, publishClaimSources } from "@/features/videos/domain/publish-metadata";
import { createVideoSchema } from "@/features/videos/schemas/video.schema";
import { CHARACTER_ACTIONS, ILLUSTRATION_SETTINGS } from "@/features/videos/domain/illustration";
import { sceneContentHash } from "@/features/videos/services/scene-records";
import { hookOptionSchema, storyboardSceneSchema, videoScriptOutputSchema } from "@/server/ai/contracts/video-script";
import { mockSceneRegeneration, mockVideoScript } from "@/server/ai/mock-video-script";
import { PUBLISH_RULE } from "@/server/ai/prompts/publish-rule";
import { STORY_REWRITE_RULE, STORYTELLING_RULE, storyAngleRule } from "@/server/ai/prompts/storytelling-rule";
import {
  buildSceneRegenerationPrompt,
  buildVideoScriptPrompt,
  VIDEO_SCRIPT_PROMPT_VERSION,
} from "@/server/ai/prompts/video-script-prompt";

const LESSON: LessonSnapshot = {
  lessonId: "lesson-1",
  title: "Bắt đầu thật nhỏ",
  summary: "Thay đổi nhỏ lặp lại tạo kết quả lớn.",
  principle: "Hành động đủ nhỏ để không thể thất bại.",
  realLifeScenario: "Minh muốn tập thể dục nhưng luôn bỏ cuộc sau ba ngày.",
  commonMistake: "Ép bản thân tập một giờ ngay ngày đầu.",
  betterApproach: "Bắt đầu bằng hai phút sau khi thay quần áo.",
  actionableStep: "Tối nay mang giày chạy và bước ra cửa.",
  contentHash: "hash",
  sources: [],
  capturedAt: "2026-10-27T00:00:00.000Z",
};

describe("duration estimates", () => {
  it("counts Vietnamese syllables and converts them to seconds", () => {
    expect(countSyllables("Vì sao bạn luôn bỏ cuộc sau ba ngày?")).toBe(9);
    expect(estimateNarrationSeconds("Vì sao bạn luôn bỏ cuộc sau ba ngày?")).toBe(2.7);
    expect(estimateNarrationSeconds("   ")).toBe(0);
  });

  it("rates the duration against the range: under the minimum, near or over the maximum", () => {
    const budget = { targetSeconds: 45, minDurationSec: 30, maxDurationSec: 60 };
    expect(assessDurationBudget(0, budget).level).toBe("empty");
    expect(assessDurationBudget(20, budget)).toMatchObject({ level: "short", minSeconds: 30, maxSeconds: 60 });
    expect(assessDurationBudget(45, budget).level).toBe("ok");
    // Longer than the AI's plan but inside the range is still fine.
    expect(assessDurationBudget(50, budget).level).toBe("ok");
    expect(assessDurationBudget(57, budget).level).toBe("near");
    const over = assessDurationBudget(65, budget);
    expect(over.level).toBe("over");
    expect(over.message).toContain("Dài hơn 5 giây so với mức tối đa 60 giây");
  });

  it("works out which lengths a range allows and fits narration to the shortest that holds it", () => {
    const range = { minDurationSec: 45, maxDurationSec: 120 };
    expect(presetsInRange(range)).toEqual([45, 60, 90, 120]);
    expect(fitToRange(10, range)).toBe(45);
    expect(fitToRange(61, range)).toBe(90);
    expect(fitToRange(500, range)).toBe(120);
    expect(clampToRange(30, range)).toBe(45);
    expect(clampToRange(300, range)).toBe(120);
    expect(clampToRange(90, range)).toBe(90);
    expect(isWithinRange(30, range)).toBe(false);
    expect(isWithinRange(120, range)).toBe(true);
    expect(formatRange({ minDurationSec: 30, maxDurationSec: 300 })).toBe("30 giây – 5 phút");
    expect(formatRange({ minDurationSec: 60, maxDurationSec: 60 })).toBe("60 giây");
  });

  it("recommends one lesson per short video and flags overload", () => {
    expect(assessLessonLoad(1, 30).level).toBe("ok");
    expect(assessLessonLoad(2, 60).level).toBe("tight");
    expect(assessLessonLoad(3, 60).level).toBe("overload");
    expect(assessLessonLoad(3, 90).level).toBe("tight");
  });
});

describe("createVideoSchema", () => {
  const base = { bookId: "b", title: "Video", lessonIds: ["l1"] };

  it("takes a range of allowed lengths, up to five minutes", () => {
    expect(createVideoSchema.parse({ ...base, minDurationSec: 30, maxDurationSec: 300 })).toMatchObject({
      minDurationSec: 30,
      maxDurationSec: 300,
    });
    expect(createVideoSchema.safeParse({ ...base, minDurationSec: 60, maxDurationSec: 60 }).success).toBe(true);
  });

  it("refuses a missing range, a length that is not offered, and a minimum above the maximum", () => {
    expect(createVideoSchema.safeParse(base).success).toBe(false);
    expect(createVideoSchema.safeParse({ ...base, minDurationSec: 30, maxDurationSec: 150 }).success).toBe(false);
    expect(createVideoSchema.safeParse({ ...base, minDurationSec: 30, maxDurationSec: 360 }).success).toBe(false);
    expect(createVideoSchema.safeParse({ ...base, minDurationSec: 90, maxDurationSec: 60 }).success).toBe(false);
  });
});

describe("mock video script", () => {
  const input = {
    videoId: "video-1",
    title: "Video thử",
    minDurationSec: 30 as const,
    maxDurationSec: 120 as const,
    pace: "STANDARD" as const,
    storyAngle: "PEAK_FIRST" as const,
    videoProfile: "SHORT_VERTICAL" as const,
    book: { title: "Thói quen nguyên tử", author: "James Clear" },
    lessons: [LESSON],
    promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
  };

  it("proposes three schema-valid hooks that each fit in three seconds", () => {
    const output = videoScriptOutputSchema.parse(mockVideoScript(input));
    expect(output.hookOptions.map((hook) => hook.variant)).toEqual(["QUESTION", "MISTAKE", "CONTRAST"]);
    for (const hook of output.hookOptions) {
      expect(estimateNarrationSeconds(hook.narration)).toBeLessThanOrEqual(HOOK_MAX_SECONDS);
    }
    expect(output.scenes.map((scene) => scene.type)).toEqual([
      "SITUATION",
      "COMMON_MISTAKE",
      "KEY_TAKEAWAY",
      "BETTER_APPROACH",
      "ACTION_STEP",
    ]);
    expect(findStorySceneOrderProblem(output.scenes.map((scene) => scene.type))).toBeNull();
  });

  it("keeps all five parts in a short or multi-lesson video, telling the lessons as one story", () => {
    const second: LessonSnapshot = {
      ...LESSON,
      lessonId: "lesson-2",
      realLifeScenario: "Lan muốn đọc sách mỗi tối. Nhưng điện thoại luôn thắng.",
    };
    const scenes = mockVideoScript({ ...input, lessons: [LESSON, second] }).scenes;

    expect(findStorySceneOrderProblem(scenes.map((scene) => scene.type))).toBeNull();
    expect(scenes[0]!.narration).toBe(`${LESSON.realLifeScenario} Lan muốn đọc sách mỗi tối.`);
    expect(mockVideoScript({ ...input, maxDurationSec: 30 }).scenes).toHaveLength(5);
  });

  it("proposes the shortest allowed length that holds its narration, and says why", () => {
    const output = videoScriptOutputSchema.parse(mockVideoScript(input));
    const seconds = [output.hookOptions[0]!.narration, ...output.scenes.map((scene) => scene.narration)]
      .map((text) => estimateNarrationSeconds(text))
      .reduce((sum, value) => sum + value, 0);

    expect(output.targetDurationSec).toBe(fitToRange(seconds, input));
    expect(output.durationReason).toContain(`${Math.ceil(seconds)} giây`);
    expect(mockVideoScript({ ...input, minDurationSec: 90 }).targetDurationSec).toBe(90);
  });

  it("asks Claude to pick one allowed length that suits the content, inside the range, and to say why", () => {
    const prompt = buildVideoScriptPrompt(input);

    expect(prompt).toContain("trong khoảng 30–120 giây");
    expect(prompt).toContain("30 (30 giây) ≈ 108 âm tiết");
    expect(prompt).toContain("120 (2 phút) ≈ 432 âm tiết");
    expect(prompt).not.toContain("180 (3 phút)");
    expect(prompt).toContain('"targetDurationSec", "durationReason"');
  });

  it("offers more narration for the same lengths at a faster pace, in both the script and the rewrite prompt", () => {
    const fast = buildVideoScriptPrompt({ ...input, pace: "FASTER" });

    expect(fast).toContain("30 (30 giây) ≈ 140 âm tiết");
    expect(fast).toContain("120 (2 phút) ≈ 561 âm tiết");
    expect(fast).toContain("nhịp rất nhanh (khoảng 5,2 âm tiết/giây)");
    expect(fast).not.toContain("Không nói nhanh để vừa");
    expect(VIDEO_SCRIPT_PROMPT_VERSION).toBe("video-script-v11");
  });

  it("tells the story the way the assigned angle says, with the shared craft rules", () => {
    const prompt = buildVideoScriptPrompt({ ...input, storyAngle: "DIALOGUE" });

    expect(prompt).toContain(STORYTELLING_RULE);
    expect(prompt).toContain(storyAngleRule("DIALOGUE"));
    expect(prompt).toContain("“Cuộc đối thoại”");
    expect(prompt).not.toContain(storyAngleRule("PEAK_FIRST"));
    expect(prompt).toContain("Phương án đầu theo góc kể được giao");
    expect(prompt).not.toContain("câu hỏi đánh trúng vấn đề");
  });

  it("does not let the ban on invented quotations forbid the lines of a character it makes up", () => {
    const prompt = buildVideoScriptPrompt(input);

    expect(prompt).toContain("trích dẫn của sách và tác giả (thoại của nhân vật tự nghĩ ra là tình huống minh hoạ");
    expect(prompt).toContain("chỉ của nhân vật tự nghĩ ra");
  });

  it("changes only the angle between two angles, so the rest of the instructions stay the same", () => {
    const strip = (angle: "TWIST" | "MYTH_BUST") =>
      buildVideoScriptPrompt({ ...input, storyAngle: angle }).replace(storyAngleRule(angle), "");

    expect(strip("TWIST")).toBe(strip("MYTH_BUST"));
  });

  it("gives a rewritten scene the short craft rule, and no angle, because it keeps the story it belongs to", () => {
    const rewrite = buildSceneRegenerationPrompt({
      videoId: "video-1",
      sceneId: "scene-2",
      attempt: 1,
      targetDurationSec: 60,
      pace: "STANDARD",
      lessons: [LESSON],
      scene: mockVideoScript(input).scenes[1]!,
      promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    });

    expect(rewrite).toContain(STORY_REWRITE_RULE);
    expect(rewrite).not.toContain("Góc kể được giao");
  });

  it("rewrites a scene differently on each attempt while keeping its type", () => {
    const scene = mockVideoScript(input).scenes[1]!;
    const regenerate = (attempt: number) =>
      mockSceneRegeneration({
        videoId: "video-1",
        sceneId: "scene-2",
        attempt,
        targetDurationSec: 60,
        pace: "STANDARD",
        lessons: [LESSON],
        scene,
        promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
      }).scene;
    expect(regenerate(1).narration).not.toBe(regenerate(2).narration);
    expect(regenerate(1).type).toBe(scene.type);
  });

  it("builds a versioned prompt with the book and lessons fenced as data", () => {
    const prompt = buildVideoScriptPrompt(input);
    expect(prompt).toContain(VIDEO_SCRIPT_PROMPT_VERSION);
    expect(prompt).toContain("<<<BEGIN_UNTRUSTED_SOURCE_TEXT>>>");
    expect(prompt).toContain("Bắt đầu thật nhỏ");
    const data = prompt.slice(prompt.indexOf("<<<BEGIN_UNTRUSTED_SOURCE_TEXT>>>"));
    expect(data).toContain("Thói quen nguyên tử");
  });

  it("asks for a title, caption and hashtags with the script, and the mock's pass the publish rules", () => {
    expect(buildVideoScriptPrompt(input)).toContain(PUBLISH_RULE);
    expect(buildVideoScriptPrompt(input)).toContain('"publish":{"title","caption","hashtags":[]}');
    const output = mockVideoScript(input);
    const scenes = output.scenes.map((scene) => ({ ...scene, title: scene.title ?? null }));
    const sources = publishClaimSources({ book: input.book, lessons: input.lessons, scenes });
    expect(
      acceptPublishMetadata(output.publish ?? { title: "", caption: "", hashtags: [] }, [
        ...sources,
        output.hookOptions[0]?.narration ?? "",
      ]).issue,
    ).toBeNull();
  });

  it("asks for a picture per hook and scene when writing a script, but not when rewriting one scene's words", () => {
    const script = buildVideoScriptPrompt(input);
    expect(script).toContain('"illustration":{"setting","action"}');
    for (const value of [...ILLUSTRATION_SETTINGS, ...CHARACTER_ACTIONS]) expect(script).toContain(value);

    const rewrite = buildSceneRegenerationPrompt({
      videoId: "video-1",
      sceneId: "scene-2",
      attempt: 1,
      targetDurationSec: 60,
      pace: "STANDARD",
      lessons: [LESSON],
      scene: mockVideoScript(input).scenes[0]!,
      promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
    });
    expect(rewrite).not.toContain("illustration");
  });
});

describe("scene illustrations from the AI", () => {
  const scene = { type: "SITUATION", narration: "Lời dẫn.", onScreenText: "CHỮ", visualVariant: "SCENARIO_CARD" };
  const hook = { variant: "QUESTION", narration: "Vì sao?", onScreenText: "VÌ SAO?", visualVariant: "HOOK_QUESTION" };

  it("accepts a scene or hook without a picture, or with one the renderer can draw", () => {
    expect(storyboardSceneSchema.safeParse(scene).success).toBe(true);
    expect(
      storyboardSceneSchema.parse({ ...scene, illustration: { setting: "CAFE", action: "TALKING" } }),
    ).toMatchObject({ illustration: { setting: "CAFE", action: "TALKING" } });
    expect(hookOptionSchema.parse({ ...hook, illustration: { setting: "STREET", action: "WALKING" } })).toMatchObject({
      illustration: { setting: "STREET", action: "WALKING" },
    });
  });

  it("rejects a setting or action the renderer does not know", () => {
    expect(
      storyboardSceneSchema.safeParse({ ...scene, illustration: { setting: "BEACH", action: "TALKING" } }).success,
    ).toBe(false);
    expect(hookOptionSchema.safeParse({ ...hook, illustration: { setting: "CAFE", action: "DANCING" } }).success).toBe(
      false,
    );
  });

  it("keeps the content hash of scenes saved before pictures existed, and changes it when a picture is chosen", () => {
    const content = {
      type: "SITUATION" as const,
      narration: "Lời.",
      onScreenText: "CHỮ",
      visualVariant: "SCENARIO_CARD" as const,
    };
    const plain = sceneContentHash(content);

    expect(sceneContentHash({ ...content, illustration: null })).toBe(plain);
    expect(sceneContentHash({ ...content, illustration: { setting: "CAFE", action: "TALKING" } })).not.toBe(plain);
    expect(sceneContentHash({ ...content, illustration: { setting: "CAFE", action: "TALKING" } })).not.toBe(
      sceneContentHash({ ...content, illustration: { setting: "CAFE", action: "WORRIED" } }),
    );
  });
});
