import type { LessonStatus, LessonText } from "../domain/lesson-fields";

export interface ChapterRef {
  id: string;
  order: number;
  title: string;
}

export interface LessonSummary {
  id: string;
  bookId: string;
  title: string;
  summary: string;
  status: LessonStatus;
  origin: "AI" | "MANUAL";
  chapters: ChapterRef[];
  usedInVideoCount: number;
  createdAt: string;
}

export interface LessonSourceDto {
  id: string;
  chapter: ChapterRef;
  excerpt: string | null;
  locator: string | null;
}

export interface LessonDetail extends LessonText {
  id: string;
  book: { id: string; title: string };
  status: LessonStatus;
  origin: "AI" | "MANUAL";
  analysisPromptVersion: string | null;
  sources: LessonSourceDto[];
  videos: { id: string; title: string }[];
  createdAt: string;
  updatedAt: string;
}
