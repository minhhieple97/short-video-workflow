import "server-only";

import { getBook } from "@/features/books/services/book.service";
import { pageFromLocator } from "@/features/lessons/domain/source-excerpts";

import { PRODUCTION_BLOCK_REASONS } from "../domain/producible-lesson";
import { findCatalogueLessons } from "../repositories/production.repository";
import type { CatalogueDto } from "../schemas/catalogue.dto";

const EXCERPT_PREVIEW_CHARS = 280;

// What the user picks from: every lesson of the book that is not archived, each with the excerpts it rests on. A lesson
// without any excerpt is shown but cannot be chosen, because a video must be traceable to the book.
export async function getCatalogue(bookId: string): Promise<CatalogueDto> {
  const book = await getBook(bookId);
  const lessons = await findCatalogueLessons(book.id);
  return {
    book: { id: book.id, title: book.title },
    lessons: lessons.map((lesson) => {
      const sources = [...lesson.sources]
        .sort((left, right) => left.chapter.order - right.chapter.order)
        .flatMap((source) => {
          const excerpt = (source.sourceExcerpt ?? "").trim();
          return excerpt
            ? [
                {
                  chapterTitle: source.chapter.title,
                  excerpt: excerpt.slice(0, EXCERPT_PREVIEW_CHARS),
                  page: pageFromLocator(source.sourceLocator),
                },
              ]
            : [];
        });
      return {
        id: lesson.id,
        title: lesson.title,
        summary: lesson.summary,
        status: lesson.status,
        usedInVideoCount: lesson._count.videoLessons,
        sources,
        unavailableReason: sources.length === 0 ? PRODUCTION_BLOCK_REASONS.NO_SOURCE : null,
      };
    }),
  };
}
