import { describe, expect, it } from "vitest";

import {
  buildLessonExtractionPrompt,
  LESSON_EXTRACTION_PROMPT_VERSION,
} from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";
import {
  buildScriptDraftPrompt,
  SCRIPT_DRAFT_PROMPT_VERSION,
} from "@/server/script-studio/notebooklm/prompts/script-draft-prompt";

import { SAMPLE_LESSON } from "../../helpers/contracts/script-studio-provider-contract";

describe("NotebookLM prompts for books in English or Vietnamese", () => {
  it("asks for lessons written in Vietnamese with excerpts kept verbatim in the source's language", () => {
    const prompt = buildLessonExtractionPrompt({
      bookTitle: "Atomic Habits",
      chapterTitle: "Chapter 1",
      partNumber: 1,
      partCount: 2,
      pages: { first: 3, last: 9 },
    });

    expect(LESSON_EXTRACTION_PROMPT_VERSION).toBe("notebooklm-lesson-extraction-v2");
    expect(prompt).toContain("tiếng Việt tự nhiên");
    expect(prompt).toContain("kể cả khi nguồn bằng tiếng Anh");
    expect(prompt).toContain("đúng ngôn ngữ của nguồn (không dịch");
    expect(prompt).toContain("trang 3–9");
  });

  it("asks for a Vietnamese script in the required story order, quoting the source only in its own language", () => {
    const prompt = buildScriptDraftPrompt({ lesson: SAMPLE_LESSON, targetDurationSec: 60, revisionNote: null });

    expect(SCRIPT_DRAFT_PROMPT_VERSION).toBe("notebooklm-script-draft-v2");
    expect(prompt).toContain("Lời dẫn LUÔN bằng tiếng Việt");
    expect(prompt).toContain("HOOK → SITUATION → MISTAKE → LESSON → RESOLUTION → ACTION");
    expect(prompt).toContain("đúng ngôn ngữ của nguồn (không dịch)");
    expect(prompt).toContain("dưới 4 giây");
  });
});
