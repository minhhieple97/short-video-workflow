import { describe, expect, it } from "vitest";

import { draftCacheKey } from "@/features/productions/services/draft-cache-key";

const studio = { id: "notebooklm", draftVersion: "notebooklm-script-draft-v1" };
const request = {
  lessonId: "lesson-1",
  lessonContentHash: "hash-1",
  minDurationSec: 30,
  maxDurationSec: 60,
  pace: "STANDARD",
  storyAngle: "PEAK_FIRST" as const,
  sourceRemoteIds: ["nb#a", "nb#b"],
  revisionNote: null,
};

describe("draftCacheKey", () => {
  it("is the same for the same request, whatever order the sources come in", () => {
    expect(draftCacheKey(studio, request)).toBe(
      draftCacheKey(studio, { ...request, sourceRemoteIds: ["nb#b", "nb#a", "nb#a"] }),
    );
  });

  it("changes with anything that could change the draft", () => {
    const base = draftCacheKey(studio, request);
    const variants = [
      draftCacheKey({ ...studio, draftVersion: "notebooklm-script-draft-v2" }, request),
      draftCacheKey({ ...studio, id: "mock-script-studio" }, request),
      draftCacheKey(studio, { ...request, lessonContentHash: "hash-2" }),
      draftCacheKey(studio, { ...request, minDurationSec: 45 }),
      draftCacheKey(studio, { ...request, maxDurationSec: 90 }),
      draftCacheKey(studio, { ...request, sourceRemoteIds: ["nb#a", "nb#c"] }),
      draftCacheKey(studio, { ...request, revisionNote: "Rút gọn." }),
      draftCacheKey(studio, { ...request, lessonId: "lesson-2" }),
      draftCacheKey(studio, { ...request, pace: "FASTER" }),
      draftCacheKey(studio, { ...request, storyAngle: "DIALOGUE" }),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });
});
