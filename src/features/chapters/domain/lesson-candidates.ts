export interface CandidateExcerpt {
  page: number;
  text: string;
}

export interface MergeableLesson {
  title: string;
  exampleIsIllustrative: boolean;
  sourceExcerpts: CandidateExcerpt[];
}

const fold = (value: string) =>
  value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Lessons from the parts of one chapter, with the ones that are plainly the same lesson (the same title once case,
// punctuation and spacing are set aside) kept once with the evidence of both. Anything less certain is left as found.
export function mergeLessonCandidates<T extends MergeableLesson>(lessons: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const lesson of lessons) {
    const key = fold(lesson.title);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...lesson, sourceExcerpts: [...lesson.sourceExcerpts] });
      continue;
    }
    const known = new Set(existing.sourceExcerpts.map((excerpt) => fold(excerpt.text)));
    for (const excerpt of lesson.sourceExcerpts) {
      if (!known.has(fold(excerpt.text))) existing.sourceExcerpts.push(excerpt);
    }
    existing.exampleIsIllustrative ||= lesson.exampleIsIllustrative;
  }
  return [...merged.values()];
}
