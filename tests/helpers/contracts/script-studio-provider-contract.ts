import { describe, expect, it } from "vitest";

import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import {
  detectedChapterSchema,
  lessonExtractionSchema,
  scriptDraftSchema,
} from "@/server/script-studio/script-studio-contracts";
import type { ScriptStudioProvider } from "@/server/script-studio/script-studio-provider";

export const SAMPLE_LESSON: LessonSnapshot = {
  lessonId: "lesson-1",
  title: "Đừng hoãn việc quan trọng",
  summary: "Tóm tắt.",
  principle: "Bắt đầu bằng hai phút đầu tiên.",
  realLifeScenario: "Bạn định tập thể dục nhưng cứ hẹn ngày mai.",
  commonMistake: "Đặt mục tiêu quá lớn ngay từ đầu.",
  betterApproach: "Thu nhỏ việc đầu tiên còn hai phút.",
  actionableStep: "Mang giày vào ngay tối nay.",
  contentHash: null,
  sources: [{ chapterId: "chapter-1", chapterTitle: "Chương 1", excerpt: "Hãy bắt đầu nhỏ." }],
  capturedAt: "2026-10-28T00:00:00.000Z",
};

export function describeScriptStudioProviderContract(name: string, createProvider: () => ScriptStudioProvider): void {
  describe(`ScriptStudioProvider contract: ${name}`, () => {
    const document = (key: string) => ({ key, title: "Sách mẫu", markdown: "# Chương 1\n\nNội dung." });

    it("reuses the remote source for the same key and creates a new one for a different key", async () => {
      const provider = createProvider();

      const first = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });
      const replay = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });
      const other = await provider.ensureSource({ document: document("book-a:hash-2"), known: null });

      expect(replay).toEqual(first);
      expect(other.remoteId).not.toBe(first.remoteId);
      expect(other.key).toBe("book-a:hash-2");
    });

    it("keeps a known reference that still exists remotely", async () => {
      const provider = createProvider();
      const created = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });

      const again = await provider.ensureSource({ document: document("book-a:hash-1"), known: created });

      expect(again).toEqual(created);
    });

    it("returns chapters that satisfy the detected-chapter contract", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });

      const chapters = await provider.detectChapters({ sources: [source], outlineHints: ["Chương 1", "Chương 2"] });

      expect(chapters.length).toBeGreaterThan(0);
      for (const chapter of chapters) expect(detectedChapterSchema.safeParse(chapter).success).toBe(true);
    });

    it("returns lessons that satisfy the extraction contract, each with at least one source excerpt", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });

      const extraction = await provider.extractLessons({
        sources: [source],
        chapterTitle: "Chương 1",
        startPage: 1,
        endPage: 10,
      });

      expect(lessonExtractionSchema.safeParse(extraction).success).toBe(true);
      for (const lesson of extraction.lessons) expect(lesson.sourceExcerpts.length).toBeGreaterThan(0);
    });

    it("writes a draft that opens with the hook and keeps sources separate from narration", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });

      const draft = await provider.writeDraft({
        sources: [source],
        lesson: SAMPLE_LESSON,
        targetDurationSec: 60,
        revisionNote: null,
      });

      expect(scriptDraftSchema.safeParse(draft).success).toBe(true);
      expect(draft.lessonId).toBe(SAMPLE_LESSON.lessonId);
      expect(draft.beats[0]?.beat).toBe("HOOK");
      expect(draft.beats.some((beat) => beat.illustrative)).toBe(true);
    });

    it("accepts a revision note on the correction pass", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });

      const draft = await provider.writeDraft({
        sources: [source],
        lesson: SAMPLE_LESSON,
        targetDurationSec: 60,
        revisionNote: "Giữ đúng trích đoạn trong sách.",
      });

      expect(scriptDraftSchema.safeParse(draft).success).toBe(true);
    });

    it("rejects every call when the signal is already aborted", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({ document: document("book-a:hash-1"), known: null });
      const controller = new AbortController();
      controller.abort();
      const options = { signal: controller.signal };

      await expect(
        provider.ensureSource({ document: document("book-a:hash-9"), known: null }, options),
      ).rejects.toThrow();
      await expect(provider.detectChapters({ sources: [source], outlineHints: [] }, options)).rejects.toThrow();
      await expect(
        provider.extractLessons({ sources: [source], chapterTitle: "Chương 1", startPage: 1, endPage: 2 }, options),
      ).rejects.toThrow();
      await expect(
        provider.writeDraft(
          { sources: [source], lesson: SAMPLE_LESSON, targetDurationSec: 60, revisionNote: null },
          options,
        ),
      ).rejects.toThrow();
    });
  });
}
