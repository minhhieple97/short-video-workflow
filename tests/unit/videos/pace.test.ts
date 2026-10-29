import { describe, expect, it } from "vitest";

import { estimateNarrationSeconds, SYLLABLES_PER_SECOND } from "@/features/videos/domain/duration";
import { createVideoSchema, updateVideoSchema } from "@/features/videos/schemas/video.schema";
import {
  DEFAULT_PACE,
  PACES,
  formatSpeedPercent,
  isPace,
  isVoiceStale,
  paceProfile,
  syllablesPerSecond,
  toPace,
} from "@/features/videos/domain/pace";

describe("pace profiles", () => {
  it("starts from STANDARD, which keeps the voice speed and pause every video had before paces existed", () => {
    expect(DEFAULT_PACE).toBe("STANDARD");
    expect(paceProfile("STANDARD")).toMatchObject({ speedPercent: 0, paddingMs: 300, animationFactor: 1 });
    expect(syllablesPerSecond("STANDARD")).toBe(SYLLABLES_PER_SECOND);
  });

  it("gets faster, never slower, from one pace to the next, up to +30% for the voice", () => {
    const profiles = PACES.map(paceProfile);
    for (const [index, profile] of profiles.entries()) {
      const previous = profiles[index - 1];
      if (!previous) continue;
      expect(profile.speedPercent).toBeGreaterThan(previous.speedPercent);
      expect(profile.paddingMs).toBeLessThan(previous.paddingMs);
      expect(profile.animationFactor).toBeGreaterThan(previous.animationFactor);
    }
    expect(paceProfile("FASTER").speedPercent).toBe(30);
  });

  it("plans the AI's word budget at the speed the voice really speaks", () => {
    expect(syllablesPerSecond("FAST")).toBe(4.6);
    expect(syllablesPerSecond("FASTER")).toBe(5.2);
  });

  it("estimates the same narration as shorter at a faster pace", () => {
    const text = "Vì sao bạn luôn bỏ cuộc sau ba ngày dù đã hứa với chính mình rất nhiều lần như vậy?";

    expect(estimateNarrationSeconds(text, syllablesPerSecond("FASTER"))).toBeLessThan(estimateNarrationSeconds(text));
    expect(estimateNarrationSeconds(text, syllablesPerSecond("STANDARD"))).toBe(estimateNarrationSeconds(text));
  });

  it("reads a stored value, and anything unknown as the default", () => {
    expect(isPace("FAST")).toBe(true);
    expect(isPace("fast")).toBe(false);
    expect(toPace("FASTER")).toBe("FASTER");
    expect(toPace("WARP")).toBe(DEFAULT_PACE);
    expect(toPace(null)).toBe(DEFAULT_PACE);
  });

  it("writes the voice speed with an explicit sign", () => {
    expect(formatSpeedPercent(0)).toBe("+0%");
    expect(formatSpeedPercent(30)).toBe("+30%");
    expect(formatSpeedPercent(-10)).toBe("-10%");
  });

  it("calls a voice stale only when a provider made it at another speed than the pace asks for", () => {
    expect(isVoiceStale({ provider: "edge-tts", speedPercent: 0 }, 30)).toBe(true);
    expect(isVoiceStale({ provider: "edge-tts", speedPercent: 30 }, 30)).toBe(false);
    expect(isVoiceStale({ provider: "edge-tts", speedPercent: null }, 30)).toBe(false);
    expect(isVoiceStale({ provider: "upload", speedPercent: 0 }, 30)).toBe(false);
  });
});

describe("pace in the video schemas", () => {
  const create = { bookId: "b", title: "T", lessonIds: ["l"], minDurationSec: 30, maxDurationSec: 60 };
  const update = { title: "T", minDurationSec: 30, maxDurationSec: 60 };

  it("takes a known pace, or none at all, and refuses any other", () => {
    expect(createVideoSchema.safeParse({ ...create, pace: "FASTER" }).success).toBe(true);
    expect(createVideoSchema.safeParse(create).success).toBe(true);
    expect(updateVideoSchema.safeParse({ ...update, pace: "FAST" }).success).toBe(true);
    expect(updateVideoSchema.safeParse(update).success).toBe(true);
    expect(createVideoSchema.safeParse({ ...create, pace: "WARP" }).success).toBe(false);
    expect(updateVideoSchema.safeParse({ ...update, pace: "fast" }).success).toBe(false);
  });
});
