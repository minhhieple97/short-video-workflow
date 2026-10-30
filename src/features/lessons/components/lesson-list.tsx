"use client";

import { useMemo } from "react";

import { Pagination } from "@/components/layout/pagination";
import { useRowSelection } from "@/lib/use-row-selection";
import type { Page } from "@/shared/pagination";

import { LESSON_PAGE_PARAM } from "../domain/paging";
import type { LessonSummary } from "../schemas/lesson.dto";
import { LessonBulkBar } from "./lesson-bulk-bar";
import { LessonTable } from "./lesson-table";

// One page of the book's lessons with a checkbox on each row and the bulk actions for the ticked ones.
export function LessonList({
  bookId,
  lessons,
  emptyHint,
}: Readonly<{ bookId: string; lessons: Page<LessonSummary>; emptyHint: string }>) {
  const rowIds = useMemo(() => lessons.items.map((lesson) => lesson.id), [lessons.items]);
  const selection = useRowSelection(rowIds);
  const selected = lessons.items.filter((lesson) => selection.selected.has(lesson.id));

  return (
    <div className="flex flex-col gap-4">
      {lessons.total > 0 ? <LessonBulkBar bookId={bookId} selected={selected} onDone={selection.clear} /> : null}
      <LessonTable lessons={lessons.items} selection={selection} emptyHint={emptyHint} />
      <Pagination page={lessons} param={LESSON_PAGE_PARAM} />
    </div>
  );
}
