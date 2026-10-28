import { createHash } from "node:crypto";

import { splitIntoParts } from "@/features/extraction/domain/source-parts";
import { loadChapterSource, type ChapterSource } from "@/features/extraction/services/chapter-source.service";
import {
  completeAiRun,
  failAiRun,
  hasCompletedAiRun,
  startAiRun,
} from "@/features/jobs/repositories/ai-run.repository";
import { pickLessonText } from "@/features/lessons/domain/lesson-fields";
import { locateExcerpt } from "@/features/lessons/domain/source-excerpts";
import {
  replaceChapterDraftLessons,
  type AnalysisDraft,
  type NewLessonSource,
} from "@/features/lessons/repositories/lesson.repository";
import { lessonContentHash } from "@/features/lessons/services/lesson-hash";
import { extractLessonsWithNotebook } from "@/features/notebooklm/services/notebook-lesson-extractor";
import {
  notebookStudioSettings,
  openBookNotebook,
  withNotebookLm,
  type NotebookStudioSettings,
} from "@/features/notebooklm/services/notebook-studio.service";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { LESSON_EXTRACTION_PROMPT_VERSION } from "@/server/script-studio/notebooklm/prompts/lesson-extraction-prompt";
import type { LessonCandidate, LessonExtraction } from "@/server/script-studio/script-studio-contracts";
import { NotFoundError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { mergeLessonCandidates } from "../domain/lesson-candidates";
import { findChapterWithBook, setChapterAnalysisStatus } from "../repositories/chapter.repository";
import type { ChapterAnalysisResult } from "./chapter-analysis.service";

const logger = createLogger("chapters.notebook-analysis");

// Each part of a chapter is its own NotebookLM source and its own question, so a long chapter is read in bounded pieces.
export const NOTEBOOK_PART_MAX_CHARS = 40_000;

export function notebookAnalysisInputHash(parts: { contentHash: string; chapterTitle: string; bookTitle: string }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        promptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
        partMaxChars: NOTEBOOK_PART_MAX_CHARS,
        ...parts,
      }),
    )
    .digest("hex");
}

// PDF books (the v1.2 flow) are catalogued by NotebookLM when it is set up; books imported from text keep the v1.1
// analysis, whatever the mode.
export async function notebookAnalysisSettingsFor(
  chapterId: string,
  settings: NotebookStudioSettings | null = notebookStudioSettings(),
): Promise<NotebookStudioSettings | null> {
  if (!settings) return null;
  const chapter = await findChapterWithBook(chapterId);
  return chapter?.book.sourceFormat === "pdf" ? settings : null;
}

export interface NotebookChapterAnalysisRun {
  chapterId: string;
  jobRecordId: string | null;
  force: boolean;
  settings: NotebookStudioSettings;
  signal?: AbortSignal;
  onProgress?: (progress: number) => Promise<void>;
}

export interface NotebookChapterAnalysisResult extends ChapterAnalysisResult {
  partial: boolean;
}

// Excerpts are kept only where they really are in the chapter, located in its text (never at the page the model
// claims) so each maps to its PDF page. A lesson with no excerpt left keeps an empty source, as in v1.1.
function toDraft(
  lesson: LessonCandidate,
  chapterId: string,
  source: ChapterSource,
): {
  draft: AnalysisDraft;
  rejected: number;
} {
  const sources: NewLessonSource[] = [];
  const offsets = new Set<number>();
  let rejected = 0;
  for (const excerpt of lesson.sourceExcerpts) {
    const offset = locateExcerpt(source.text, excerpt.text);
    if (offset === null || offsets.has(offset)) {
      rejected += 1;
      continue;
    }
    offsets.add(offset);
    const page = source.pageAt(offset);
    sources.push({
      chapterId,
      sourceExcerpt: excerpt.text.replace(/\s+/g, " ").trim(),
      sourceLocator: page === null ? `offset:${offset}` : `page:${page};offset:${offset}`,
      confidence: 1,
    });
  }
  const text = pickLessonText(lesson);
  return {
    draft: {
      text,
      contentHash: lessonContentHash(text),
      sources:
        sources.length > 0 ? sources : [{ chapterId, sourceExcerpt: null, sourceLocator: null, confidence: null }],
    },
    rejected,
  };
}

async function readParts(
  run: NotebookChapterAnalysisRun,
  chapter: { id: string; bookId: string; title: string; book: { title: string } },
  source: ChapterSource,
): Promise<LessonExtraction[]> {
  const parts = splitIntoParts(source.text, NOTEBOOK_PART_MAX_CHARS);
  return withNotebookLm(run.settings, run.signal, async (caller) => {
    const notebook = await openBookNotebook(
      caller,
      run.settings.profile,
      { id: chapter.bookId, title: chapter.book.title },
      run.signal,
    );
    const extractions: LessonExtraction[] = [];
    for (const [index, part] of parts.entries()) {
      const first = source.pageAt(part.start);
      const last = source.pageAt(Math.max(part.start, part.end - 1));
      extractions.push(
        await extractLessonsWithNotebook(
          notebook,
          {
            document: {
              key: `chapter:${chapter.id}:part:${index + 1}`,
              title: `${chapter.title} — phần ${index + 1}/${parts.length}`,
              markdown: source.forReading(part.start, part.end),
            },
            prompt: {
              bookTitle: chapter.book.title,
              chapterTitle: chapter.title,
              partNumber: index + 1,
              partCount: parts.length,
              pages: first !== null && last !== null ? { first, last } : null,
            },
          },
          run.signal,
        ),
      );
      await run.onProgress?.(10 + Math.round(((index + 1) / parts.length) * 70));
    }
    return extractions;
  });
}

// Catalogues one chapter of a PDF book with NotebookLM, part by part, with no fixed number of lessons per chapter. A run
// replaces the chapter's earlier AI drafts, so a retry never multiplies lessons, and a chapter where the reader stopped
// early is marked PARTIAL, never ANALYZED.
export async function runNotebookChapterAnalysis(
  run: NotebookChapterAnalysisRun,
): Promise<NotebookChapterAnalysisResult> {
  const chapter = await findChapterWithBook(run.chapterId);
  if (!chapter) throw new NotFoundError("CHAPTER_NOT_FOUND", "Không tìm thấy chương.");
  const inputHash = notebookAnalysisInputHash({
    contentHash: chapter.contentHash,
    chapterTitle: chapter.title,
    bookTitle: chapter.book.title,
  });
  const upToDate =
    chapter.analysisStatus === "ANALYZED" &&
    chapter.analysisPromptVersion === LESSON_EXTRACTION_PROMPT_VERSION &&
    (await hasCompletedAiRun(inputHash));
  if (upToDate && !run.force) {
    return { skipped: true, lessonsCreated: 0, lessonsArchived: 0, excerptsRejected: 0, partial: false };
  }

  await setChapterAnalysisStatus(chapter.id, "ANALYZING");
  const aiRun = await startAiRun({
    jobRecordId: run.jobRecordId,
    mode: "notebooklm",
    promptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
    inputHash,
  });
  try {
    const source = await loadChapterSource(chapter, chapter.book.sourceFormat);
    const extractions = await readParts(run, chapter, source);
    const partial = extractions.some((extraction) => !extraction.complete);
    const lessons = mergeLessonCandidates(extractions.flatMap((extraction) => extraction.lessons));

    let excerptsRejected = 0;
    const drafts = lessons.map((lesson) => {
      const { draft, rejected } = toDraft(lesson, chapter.id, source);
      excerptsRejected += rejected;
      return draft;
    });

    const outputPath = `ai-tasks/${run.jobRecordId ?? aiRun.id}/notebooklm-lessons.json`;
    await writeFileAtomic(dataPath(outputPath), `${JSON.stringify(extractions, null, 2)}\n`);
    const { created, archived } = await replaceChapterDraftLessons({
      bookId: chapter.bookId,
      chapterId: chapter.id,
      promptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
      drafts,
    });
    await completeAiRun(aiRun.id, outputPath);
    await setChapterAnalysisStatus(chapter.id, partial ? "PARTIAL" : "ANALYZED", {
      analyzedAt: new Date(),
      analysisPromptVersion: LESSON_EXTRACTION_PROMPT_VERSION,
    });
    await run.onProgress?.(100);
    logger.info("Chapter catalogued with NotebookLM", {
      chapterId: chapter.id,
      parts: extractions.length,
      lessons: created.length,
      excerptsRejected,
      partial,
    });
    return { skipped: false, lessonsCreated: created.length, lessonsArchived: archived, excerptsRejected, partial };
  } catch (error) {
    await failAiRun(aiRun.id, toSafeErrorMessage(error));
    await setChapterAnalysisStatus(chapter.id, "FAILED");
    throw error;
  }
}
