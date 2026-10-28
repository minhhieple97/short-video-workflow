import type { ChapterDetector } from "@/features/extraction/services/chapter-detector";
import { CHAPTER_DETECTION_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/chapter-detection-prompt";
import { createLogger } from "@/shared/logger";

import { NotebookLmScriptStudio } from "./notebooklm-script-studio";
import { notebookStudioSettings, type NotebookStudioSettings } from "./notebook-studio.service";

const logger = createLogger("notebooklm.chapters");

// NotebookLM reads an outline of page heads (never the whole book) as its own source and proposes chapter starts. Null
// when NotebookLM is not available, so the caller can say why no chapters were found.
export function createNotebookChapterDetector(
  settings: NotebookStudioSettings | null = notebookStudioSettings(),
): ChapterDetector | null {
  if (!settings) return null;
  return {
    detect: async (input, signal) => {
      const studio = new NotebookLmScriptStudio(settings);
      try {
        const source = await studio.ensureSource(
          {
            book: input.book,
            document: {
              key: `outline:${input.extractionId}`,
              title: "Dàn ý theo trang",
              markdown: input.outline.markdown,
            },
            known: null,
          },
          { signal },
        );
        const chapters = await studio.detectChapters(
          {
            sources: [source],
            outlineHints: input.outline.hints,
            bookTitle: input.book.title,
            pageCount: input.pageCount,
          },
          { signal },
        );
        logger.info("Chapters proposed", {
          extractionId: input.extractionId,
          chapters: chapters.length,
          promptVersion: CHAPTER_DETECTION_PROMPT_VERSION,
        });
        return chapters;
      } finally {
        await studio.close();
      }
    },
  };
}
