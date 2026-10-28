import type { LessonStatus } from "@/features/lessons/domain/lesson-fields";

export interface CatalogueSourceDto {
  chapterTitle: string;
  excerpt: string;
  // The PDF page the excerpt was found on; null for books without pages.
  page: number | null;
}

// A lesson as offered for production: what it says, where in the book it comes from, and whether it can be chosen.
export interface CatalogueLessonDto {
  id: string;
  title: string;
  summary: string;
  status: LessonStatus;
  usedInVideoCount: number;
  sources: CatalogueSourceDto[];
  // Null when the lesson can be chosen; otherwise why not, in the user's words.
  unavailableReason: string | null;
}

export interface CatalogueDto {
  book: { id: string; title: string };
  lessons: CatalogueLessonDto[];
}
