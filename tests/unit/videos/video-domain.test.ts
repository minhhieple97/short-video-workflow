import { describe, expect, it } from "vitest";

import {
  assessDurationBudget,
  assessLessonLoad,
  countSyllables,
  estimateNarrationSeconds,
  HOOK_MAX_SECONDS,
} from "@/features/videos/domain/duration";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import { createVideoSchema } from "@/features/videos/schemas/video.schema";
import { videoScriptOutputSchema } from "@/server/ai/contracts/video-script";
import { mockSceneRegeneration, mockVideoScript } from "@/server/ai/mock-video-script";
import { buildVideoScriptPrompt, VIDEO_SCRIPT_PROMPT_VERSION } from "@/server/ai/prompts/video-script-prompt";

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

  it("rates the duration budget against the preset", () => {
    expect(assessDurationBudget(0, 60).level).toBe("empty");
    expect(assessDurationBudget(20, 60).level).toBe("short");
    expect(assessDurationBudget(45, 60).level).toBe("ok");
    expect(assessDurationBudget(57, 60).level).toBe("near");
    const over = assessDurationBudget(65, 60);
    expect(over.level).toBe("over");
    expect(over.message).toContain("Dài hơn 5 giây");
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

  it("defaults to 60 seconds and accepts 30/45/60 without the extended flag", () => {
    expect(createVideoSchema.parse(base)).toMatchObject({ targetDurationSec: 60, extended: false });
    expect(createVideoSchema.parse({ ...base, targetDurationSec: 45 }).targetDurationSec).toBe(45);
  });

  it("allows the long presets, up to five minutes, only as an explicit choice of a long video", () => {
    for (const seconds of [90, 120, 180, 240, 300]) {
      expect(createVideoSchema.safeParse({ ...base, targetDurationSec: seconds }).success).toBe(false);
      expect(createVideoSchema.parse({ ...base, targetDurationSec: seconds, extended: true }).targetDurationSec).toBe(
        seconds,
      );
    }
    expect(createVideoSchema.safeParse({ ...base, targetDurationSec: 60, extended: true }).success).toBe(false);
    expect(createVideoSchema.safeParse({ ...base, targetDurationSec: 150, extended: true }).success).toBe(false);
    expect(createVideoSchema.safeParse({ ...base, targetDurationSec: 360, extended: true }).success).toBe(false);
  });
});

describe("mock video script", () => {
  const input = {
    videoId: "video-1",
    title: "Video thử",
    targetDurationSec: 60 as const,
    videoProfile: "SHORT_VERTICAL" as const,
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
      "BETTER_APPROACH",
      "KEY_TAKEAWAY",
      "ACTION_STEP",
    ]);
  });

  it("compacts the storyboard for 30-second videos", () => {
    expect(mockVideoScript({ ...input, targetDurationSec: 30 }).scenes.map((scene) => scene.type)).toEqual([
      "SITUATION",
      "BETTER_APPROACH",
      "ACTION_STEP",
    ]);
  });

  it("rewrites a scene differently on each attempt while keeping its type", () => {
    const scene = mockVideoScript(input).scenes[1]!;
    const regenerate = (attempt: number) =>
      mockSceneRegeneration({
        videoId: "video-1",
        sceneId: "scene-2",
        attempt,
        targetDurationSec: 60,
        lessons: [LESSON],
        scene,
        promptVersion: VIDEO_SCRIPT_PROMPT_VERSION,
      }).scene;
    expect(regenerate(1).narration).not.toBe(regenerate(2).narration);
    expect(regenerate(1).type).toBe(scene.type);
  });

  it("builds a versioned prompt with the lessons fenced as data", () => {
    const prompt = buildVideoScriptPrompt(input);
    expect(prompt).toContain(VIDEO_SCRIPT_PROMPT_VERSION);
    expect(prompt).toContain("<<<BEGIN_UNTRUSTED_SOURCE_TEXT>>>");
    expect(prompt).toContain("Bắt đầu thật nhỏ");
  });
});
