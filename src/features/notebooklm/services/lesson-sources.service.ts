import { findChapterWithBook } from "@/features/chapters/repositories/chapter.repository";
import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import type { ScriptStudioProvider, SourceRef } from "@/server/script-studio/script-studio-provider";

import { chapterPartDocuments } from "./chapter-documents.service";

// The sources a lesson's script is written from: every part of every chapter the lesson cites, as the same NotebookLM
// sources the chapter was catalogued from (so nothing is uploaded again). A chapter that no longer exists is skipped;
// with no source left, the script studio refuses to answer rather than write from nothing.
export async function resolveLessonSources(
  studio: ScriptStudioProvider,
  input: { bookId: string; lesson: LessonSnapshot; signal?: AbortSignal },
): Promise<SourceRef[]> {
  const chapterIds = [...new Set(input.lesson.sources.map((source) => source.chapterId))];
  const refs: SourceRef[] = [];
  for (const chapterId of chapterIds) {
    const chapter = await findChapterWithBook(chapterId);
    if (!chapter || chapter.bookId !== input.bookId) continue;
    const { parts } = await chapterPartDocuments(chapter, chapter.book.sourceFormat);
    for (const part of parts) {
      refs.push(
        await studio.ensureSource(
          { book: { id: chapter.bookId, title: chapter.book.title }, document: part.document, known: null },
          { signal: input.signal },
        ),
      );
    }
  }
  return refs;
}
