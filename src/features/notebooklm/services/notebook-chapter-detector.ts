import { z } from "zod";

import type { ChapterDetector } from "@/features/extraction/services/chapter-detector";
import {
  buildChapterDetectionPrompt,
  CHAPTER_DETECTION_PROMPT_VERSION,
} from "@/server/script-studio/notebooklm/prompts/chapter-detection-prompt";
import { detectedChapterSchema } from "@/server/script-studio/script-studio-contracts";
import { createLogger } from "@/shared/logger";

import {
  askNotebookForJson,
  ensureNotebookDocument,
  notebookStudioSettings,
  openBookNotebook,
  withNotebookLm,
  type NotebookStudioSettings,
} from "./notebook-studio.service";

const logger = createLogger("notebooklm.chapters");
const MAX_CHAPTERS = 500;

// NotebookLM reads an outline of page heads (never the whole book) as its own source and proposes chapter starts. Null
// when NotebookLM is not available, so the caller can say why no chapters were found.
export function createNotebookChapterDetector(
  settings: NotebookStudioSettings | null = notebookStudioSettings(),
): ChapterDetector | null {
  if (!settings) return null;
  return {
    detect: (input, signal) =>
      withNotebookLm(settings, signal, async (caller) => {
        const notebook = await openBookNotebook(caller, settings.profile, input.book, signal);
        const sourceId = await ensureNotebookDocument(
          notebook,
          { key: `outline:${input.extractionId}`, title: "Dàn ý theo trang", markdown: input.outline.markdown },
          signal,
        );
        const chapters = await askNotebookForJson(
          notebook,
          {
            sourceIds: [sourceId],
            query: buildChapterDetectionPrompt({
              bookTitle: input.book.title,
              pageCount: input.pageCount,
              hints: input.outline.hints,
            }),
            code: "NOTEBOOKLM_CHAPTERS_INVALID",
          },
          z.array(detectedChapterSchema).max(MAX_CHAPTERS),
          signal,
        );
        logger.info("Chapters proposed", {
          extractionId: input.extractionId,
          chapters: chapters.length,
          promptVersion: CHAPTER_DETECTION_PROMPT_VERSION,
        });
        return chapters;
      }),
  };
}
