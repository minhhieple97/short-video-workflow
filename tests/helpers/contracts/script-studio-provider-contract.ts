import { describe, expect, it } from "vitest";
import type { PublishBook } from "@/server/ai/contracts/publish-metadata";

import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import {
  detectedChapterSchema,
  lessonExtractionSchema,
  scriptDraftSchema,
} from "@/server/script-studio/script-studio-contracts";
import type { ScriptStudioProvider } from "@/server/script-studio/script-studio-provider";

export const SAMPLE_BOOK: PublishBook = { title: "Thói quen nguyên tử", author: "James Clear" };

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

// The contract's book; a provider that keeps sources per book needs it to exist.
export const CONTRACT_BOOK = { id: "contract-book", title: "Sách mẫu" };

export function describeScriptStudioProviderContract(name: string, createProvider: () => ScriptStudioProvider): void {
  describe(`ScriptStudioProvider contract: ${name}`, () => {
    const document = (key: string) => ({ key, title: "Sách mẫu", markdown: "# Chương 1\n\nNội dung." });

    it("reuses the remote source for the same key and creates a new one for a different key", async () => {
      const provider = createProvider();

      const first = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });
      const replay = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });
      const other = await provider.ensureSource({
        document: document("book-a:hash-2"),
        known: null,
        book: CONTRACT_BOOK,
      });

      expect(replay).toEqual(first);
      expect(other.remoteId).not.toBe(first.remoteId);
      expect(other.key).toBe("book-a:hash-2");
    });

    it("keeps a known reference that still exists remotely", async () => {
      const provider = createProvider();
      const created = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });

      const again = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: created,
        book: CONTRACT_BOOK,
      });

      expect(again).toEqual(created);
    });

    it("returns chapters that satisfy the detected-chapter contract", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });

      const chapters = await provider.detectChapters({
        sources: [source],
        outlineHints: ["Chương 1", "Chương 2"],
        bookTitle: CONTRACT_BOOK.title,
        pageCount: 20,
      });

      expect(chapters.length).toBeGreaterThan(0);
      for (const chapter of chapters) expect(detectedChapterSchema.safeParse(chapter).success).toBe(true);
    });

    it("returns lessons that satisfy the extraction contract, each with at least one source excerpt", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });

      const extraction = await provider.extractLessons({
        sources: [source],
        bookTitle: CONTRACT_BOOK.title,
        chapterTitle: "Chương 1",
        partNumber: 1,
        partCount: 1,
        startPage: 1,
        endPage: 10,
      });

      expect(lessonExtractionSchema.safeParse(extraction).success).toBe(true);
      for (const lesson of extraction.lessons) expect(lesson.sourceExcerpts.length).toBeGreaterThan(0);
    });

    it("writes a draft that opens with the hook and keeps sources separate from narration", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });

      const draft = await provider.writeDraft({
        sources: [source],
        lesson: SAMPLE_LESSON,
        range: { minDurationSec: 30, maxDurationSec: 60 },
        pace: "STANDARD" as const,
        storyAngle: "PEAK_FIRST" as const,
        revisionNote: null,
      });

      expect(scriptDraftSchema.safeParse(draft).success).toBe(true);
      expect(draft.lessonId).toBe(SAMPLE_LESSON.lessonId);
      expect(draft.beats[0]?.beat).toBe("HOOK");
      expect(draft.beats.some((beat) => beat.illustrative)).toBe(true);
      expect(draft.targetDurationSec).toBeGreaterThanOrEqual(30);
      expect(draft.targetDurationSec).toBeLessThanOrEqual(60);
      expect(draft.durationReason.trim()).not.toBe("");
    });

    it("accepts a revision note on the correction pass", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });

      const draft = await provider.writeDraft({
        sources: [source],
        lesson: SAMPLE_LESSON,
        range: { minDurationSec: 30, maxDurationSec: 60 },
        pace: "STANDARD" as const,
        storyAngle: "PEAK_FIRST" as const,
        revisionNote: "Giữ đúng trích đoạn trong sách.",
      });

      expect(scriptDraftSchema.safeParse(draft).success).toBe(true);
    });

    it("rejects every call when the signal is already aborted", async () => {
      const provider = createProvider();
      const source = await provider.ensureSource({
        document: document("book-a:hash-1"),
        known: null,
        book: CONTRACT_BOOK,
      });
      const controller = new AbortController();
      controller.abort();
      const options = { signal: controller.signal };

      await expect(
        provider.ensureSource({ document: document("book-a:hash-9"), known: null, book: CONTRACT_BOOK }, options),
      ).rejects.toThrow();
      await expect(
        provider.detectChapters({ sources: [source], outlineHints: [], bookTitle: "", pageCount: 1 }, options),
      ).rejects.toThrow();
      await expect(
        provider.extractLessons(
          {
            sources: [source],
            bookTitle: "",
            chapterTitle: "Chương 1",
            partNumber: 1,
            partCount: 1,
            startPage: 1,
            endPage: 2,
          },
          options,
        ),
      ).rejects.toThrow();
      await expect(
        provider.writeDraft(
          {
            sources: [source],
            lesson: SAMPLE_LESSON,
            range: { minDurationSec: 30, maxDurationSec: 60 },
            pace: "STANDARD" as const,
            storyAngle: "PEAK_FIRST" as const,
            revisionNote: null,
          },
          options,
        ),
      ).rejects.toThrow();
    });
  });
}
