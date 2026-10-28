import {
  buildLessonExtractionPrompt,
  type LessonExtractionPromptInput,
} from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";
import { lessonExtractionSchema, type LessonExtraction } from "@/server/script-studio/script-studio-contracts";

import {
  askNotebookForJson,
  ensureNotebookDocument,
  type BookNotebook,
  type NotebookDocument,
} from "./notebook-studio.service";

// One bounded part of a chapter as its own source, and the lessons NotebookLM finds in that part alone.
export async function extractLessonsWithNotebook(
  notebook: BookNotebook,
  part: { document: NotebookDocument; prompt: LessonExtractionPromptInput },
  signal?: AbortSignal,
): Promise<LessonExtraction> {
  const sourceId = await ensureNotebookDocument(notebook, part.document, signal);
  return askNotebookForJson(
    notebook,
    { sourceIds: [sourceId], query: buildLessonExtractionPrompt(part.prompt), code: "NOTEBOOKLM_LESSONS_INVALID" },
    lessonExtractionSchema,
    signal,
  );
}
