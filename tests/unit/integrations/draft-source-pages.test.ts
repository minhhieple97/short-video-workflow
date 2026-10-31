import { describe, expect, it } from "vitest";

import { NARRATIVE_BEATS } from "@/features/videos/domain/narrative-beats";
import { createDraftArtifact, scriptDraftArtifactSchema } from "@/server/scene-plan/handoff";
import {
  detectedChapterSchema,
  lessonCandidateSchema,
  scriptDraftBeatSchema,
  sourceExcerptSchema,
  type ScriptDraft,
} from "@/server/script-studio/script-studio-contracts";

const legacyDraft: ScriptDraft = {
  lessonId: "legacy-lesson",
  targetDurationSec: 60,
  durationReason: "Vừa đủ.",
  beats: NARRATIVE_BEATS.map((beat) => ({
    beat,
    narration: "Lời dẫn.",
    sourceExcerpts: beat === "LESSON" ? [{ page: 12, text: "Hãy bắt đầu nhỏ." }] : [],
    illustrative: beat === "SITUATION",
  })),
};

describe("draft source pages", () => {
  it("preserves an explicitly unknown page without inventing one", () => {
    const parsed = scriptDraftBeatSchema.parse({
      beat: "LESSON",
      narration: "Bắt đầu nhỏ.",
      sourceExcerpts: [{ page: null, text: "Hãy bắt đầu nhỏ." }],
      illustrative: false,
    });

    expect(parsed.sourceExcerpts).toEqual([{ page: null, text: "Hãy bắt đầu nhỏ." }]);
  });

  it.each([undefined, 0, -1, 1.5])("rejects invalid draft page %s rather than defaulting it", (page) => {
    expect(
      scriptDraftBeatSchema.safeParse({
        beat: "LESSON",
        narration: "Lời dẫn.",
        sourceExcerpts: [{ page, text: "Trích đoạn." }],
        illustrative: false,
      }).success,
    ).toBe(false);
  });

  it("keeps lesson extraction and detected chapter pages mandatory", () => {
    expect(sourceExcerptSchema.safeParse({ page: null, text: "Trích đoạn." }).success).toBe(false);
    expect(
      lessonCandidateSchema.safeParse({
        title: "Bắt đầu nhỏ",
        summary: "Tóm tắt.",
        principle: "Nguyên lý.",
        realLifeScenario: "Tình huống.",
        commonMistake: "Sai lầm.",
        betterApproach: "Giải pháp.",
        actionableStep: "Hành động.",
        exampleIsIllustrative: true,
        sourceExcerpts: [{ page: null, text: "Trích đoạn." }],
      }).success,
    ).toBe(false);
    for (const pages of [
      { startPage: null, endPage: 2 },
      { startPage: 1, endPage: null },
    ]) {
      expect(detectedChapterSchema.safeParse({ title: "Chương 1", startAnchor: "Chương một", ...pages }).success).toBe(
        false,
      );
    }
  });

  it("reads an existing numeric-page artifact without changing its content or fingerprint", () => {
    const artifact = {
      schemaVersion: "script-draft-v1",
      fingerprint: "115ce7f8588c0c4c3bee1341e0aa65b36b3d66221d1fb0c1a8f941f0ac042079",
      lessonContentHash: "legacy-hash",
      targetDurationSec: 60,
      draft: legacyDraft,
    };

    expect(scriptDraftArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it("round-trips a new artifact with an unknown page and detects a later page edit", () => {
    const draft: ScriptDraft = {
      ...legacyDraft,
      beats: legacyDraft.beats.map((beat) => ({
        ...beat,
        sourceExcerpts: beat.sourceExcerpts.map((excerpt) => ({ ...excerpt, page: null })),
      })),
    };
    const artifact = createDraftArtifact({ draft, lessonContentHash: "legacy-hash", targetDurationSec: 60 });

    expect(scriptDraftArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(scriptDraftArtifactSchema.safeParse({ ...artifact, draft: legacyDraft }).success).toBe(false);
  });
});
