"use client";

import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import type { RowSelection } from "@/lib/use-row-selection";

import { selectionBlockedNote } from "../domain/analysis-status";
import type { ChapterSummary } from "../schemas/chapter.dto";
import { AnalyzeChapterButton } from "./analyze-chapter-button";
import { ChapterStatusBadge } from "./chapter-status-badge";

export function ChapterTable({
  chapters,
  selection,
  emptyHint,
}: Readonly<{ chapters: readonly ChapterSummary[]; selection: RowSelection; emptyHint?: string }>) {
  if (chapters.length === 0) {
    return <EmptyState title="Sách chưa có chương nào" description={emptyHint} />;
  }

  const { selectable, selected } = selection;

  return (
    <Table className="min-w-4xl table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Chọn tất cả chương cần phân tích"
              disabled={selectable.size === 0}
              checked={selection.headerState}
              onCheckedChange={(checked) => selection.toggleAll(checked === true)}
            />
          </TableHead>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Chương</TableHead>
          <TableHead className="w-32 text-right">Độ dài</TableHead>
          <TableHead className="w-44">Phân tích</TableHead>
          <TableHead className="w-24 text-right">Bài học</TableHead>
          <TableHead className="w-24 text-right">Thao tác</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {chapters.map((chapter) => {
          const canSelect = selectable.has(chapter.id);
          return (
            <TableRow key={chapter.id} data-state={selected.has(chapter.id) ? "selected" : undefined}>
              <TableCell title={canSelect ? undefined : selectionBlockedNote(chapter.analysisStatus)}>
                <Checkbox
                  aria-label={`Chọn chương ${chapter.order} để phân tích`}
                  disabled={!canSelect}
                  checked={selected.has(chapter.id)}
                  onCheckedChange={(checked) => selection.toggle(chapter.id, checked === true)}
                />
              </TableCell>
              <TableCell className="text-muted-foreground">{chapter.order}</TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  href={`/books/${chapter.bookId}/chapters/${chapter.id}`}
                  title={chapter.title}
                  className="line-clamp-2 font-medium wrap-break-word hover:underline"
                >
                  {chapter.title}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(chapter.sourceLength)} ký tự</TableCell>
              <TableCell>
                <ChapterStatusBadge status={chapter.analysisStatus} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{chapter.lessonCount}</TableCell>
              <TableCell className="text-right">
                <AnalyzeChapterButton chapterId={chapter.id} status={chapter.analysisStatus} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
