// Orders lessons by the first chapter they cite, keeping the given order among lessons of the same chapter. A lesson that
// cites no chapter goes last.
export function orderByFirstChapter<T extends { chapterOrders: readonly number[] }>(lessons: readonly T[]): T[] {
  const firstChapter = (lesson: T) =>
    lesson.chapterOrders.length > 0 ? Math.min(...lesson.chapterOrders) : Number.POSITIVE_INFINITY;
  return lessons
    .map((lesson, index) => ({ lesson, index, first: firstChapter(lesson) }))
    .sort((a, b) => a.first - b.first || a.index - b.index)
    .map(({ lesson }) => lesson);
}
