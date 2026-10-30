"use client";

import { useMemo } from "react";

import { Pagination } from "@/components/layout/pagination";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import type {
  ActiveProductionsByLesson,
  ProductionSettingsDto,
} from "@/features/productions/schemas/production-settings.dto";
import { useRowSelection } from "@/lib/use-row-selection";
import type { Page } from "@/shared/pagination";

import { LESSON_PAGE_PARAM } from "../domain/paging";
import type { LessonSummary } from "../schemas/lesson.dto";
import { LessonBulkBar } from "./lesson-bulk-bar";
import { LessonTable } from "./lesson-table";

interface LessonListProps {
  bookId: string;
  lessons: Page<LessonSummary>;
  emptyHint: string;
  production: ProductionSettingsDto;
  // The production each lesson of this page is being made in right now, by lesson id.
  activeProductions: ActiveProductionsByLesson;
}

// One page of the book's lessons with a checkbox on each row and the bulk actions for the ticked ones.
export function LessonList({ bookId, lessons, emptyHint, production, activeProductions }: Readonly<LessonListProps>) {
  const rowIds = useMemo(() => lessons.items.map((lesson) => lesson.id), [lessons.items]);
  const selection = useRowSelection(rowIds);
  const selected = lessons.items.filter((lesson) => selection.selected.has(lesson.id));

  return (
    <div className="flex flex-col gap-4">
      <JobsAutoRefresh active={Object.keys(activeProductions).length > 0} />
      {lessons.total > 0 ? (
        <LessonBulkBar
          bookId={bookId}
          selected={selected}
          production={production}
          activeProductions={activeProductions}
          onDone={selection.clear}
        />
      ) : null}
      <LessonTable
        lessons={lessons.items}
        selection={selection}
        activeProductions={activeProductions}
        emptyHint={emptyHint}
      />
      <Pagination page={lessons} param={LESSON_PAGE_PARAM} />
    </div>
  );
}
