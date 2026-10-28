import type { LessonSnapshot } from "../domain/lesson-snapshot";

export interface LessonForSnapshot {
  id: string;
  title: string;
  summary: string;
  principle: string;
  realLifeScenario: string;
  commonMistake: string;
  betterApproach: string;
  actionableStep: string;
  contentHash: string | null;
  sources: { sourceExcerpt: string | null; chapter: { id: string; title: string } }[];
}

// A video keeps this copy of the lesson as it was when the video was made, so editing the lesson later changes nothing.
export function buildLessonSnapshot(lesson: LessonForSnapshot, capturedAt: string): LessonSnapshot {
  return {
    lessonId: lesson.id,
    title: lesson.title,
    summary: lesson.summary,
    principle: lesson.principle,
    realLifeScenario: lesson.realLifeScenario,
    commonMistake: lesson.commonMistake,
    betterApproach: lesson.betterApproach,
    actionableStep: lesson.actionableStep,
    contentHash: lesson.contentHash,
    sources: lesson.sources.map((source) => ({
      chapterId: source.chapter.id,
      chapterTitle: source.chapter.title,
      excerpt: source.sourceExcerpt,
    })),
    capturedAt,
  };
}
