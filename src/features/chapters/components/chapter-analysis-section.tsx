"use client";

import { useMemo } from "react";

import { Pagination } from "@/components/layout/pagination";
import { useRowSelection } from "@/lib/use-row-selection";
import type { Page } from "@/shared/pagination";

import type { BookAnalysisOverview, PendingExtraction } from "../domain/analysis-progress";
import { CHAPTER_PAGE_PARAM } from "../domain/paging";
import type { ChapterSummary } from "../schemas/chapter.dto";
import { BookAnalysisPanel } from "./book-analysis-panel";
import { ChapterTable } from "./chapter-table";

// The chapters tab: the analyse button and the table share one selection, so ticking rows changes what the button
// queues. Only the shown page's rows can be ticked; with nothing ticked the button still covers every chapter.
export function ChapterAnalysisSection({
  bookId,
  aiMode,
  overview,
  extraction,
  chapters,
  emptyHint,
}: Readonly<{
  bookId: string;
  aiMode: string;
  overview: BookAnalysisOverview;
  extraction: PendingExtraction;
  chapters: Page<ChapterSummary>;
  emptyHint?: string;
}>) {
  const selectableIds = useMemo(() => {
    const needsAnalysis = new Set(overview.needsAnalysisIds);
    return chapters.items.filter((chapter) => needsAnalysis.has(chapter.id)).map((chapter) => chapter.id);
  }, [overview.needsAnalysisIds, chapters.items]);
  const selection = useRowSelection(selectableIds);

  return (
    <div className="flex flex-col gap-4">
      <BookAnalysisPanel
        bookId={bookId}
        aiMode={aiMode}
        overview={overview}
        extraction={extraction}
        selectedIds={[...selection.selected]}
        onRequested={selection.clear}
      />
      <ChapterTable chapters={chapters.items} selection={selection} emptyHint={emptyHint} />
      <Pagination page={chapters} param={CHAPTER_PAGE_PARAM} />
    </div>
  );
}
