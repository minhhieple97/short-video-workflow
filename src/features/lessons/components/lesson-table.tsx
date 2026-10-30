"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActiveProductionsByLesson } from "@/features/productions/schemas/production-settings.dto";
import type { RowSelection } from "@/lib/use-row-selection";

import type { LessonSummary } from "../schemas/lesson.dto";
import { LessonOriginBadge, LessonStatusBadge } from "./lesson-badges";

export function LessonTable({
  lessons,
  selection,
  activeProductions,
  emptyHint,
}: Readonly<{
  lessons: readonly LessonSummary[];
  selection: RowSelection;
  activeProductions: ActiveProductionsByLesson;
  emptyHint: string;
}>) {
  if (lessons.length === 0) return <EmptyState title="Không có bài học phù hợp" description={emptyHint} />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Chọn tất cả bài học trên trang này"
              checked={selection.headerState}
              onCheckedChange={(checked) => selection.toggleAll(checked === true)}
            />
          </TableHead>
          <TableHead>Bài học</TableHead>
          <TableHead>Chương nguồn</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right">Đã dùng</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lessons.map((lesson) => (
          <TableRow key={lesson.id} data-state={selection.selected.has(lesson.id) ? "selected" : undefined}>
            <TableCell>
              <Checkbox
                aria-label={`Chọn bài học “${lesson.title}”`}
                checked={selection.selected.has(lesson.id)}
                onCheckedChange={(checked) => selection.toggle(lesson.id, checked === true)}
              />
            </TableCell>
            <TableCell className="max-w-md whitespace-normal">
              <Link
                href={`/books/${lesson.bookId}/lessons/${lesson.id}`}
                title={lesson.title}
                className="line-clamp-2 font-medium wrap-break-word hover:underline"
              >
                {lesson.title}
              </Link>
              <p className="text-muted-foreground line-clamp-2 text-xs">{lesson.summary}</p>
            </TableCell>
            <TableCell className="text-muted-foreground text-xs whitespace-normal">
              {lesson.chapters.map((chapter) => `Chương ${chapter.order}`).join(", ")}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <LessonStatusBadge status={lesson.status} />
                <LessonOriginBadge origin={lesson.origin} />
                {Object.hasOwn(activeProductions, lesson.id) ? (
                  <Link
                    href={`/productions/${activeProductions[lesson.id]}`}
                    title="Đang được làm video tự động. Bấm để xem tiến độ."
                    className="inline-flex"
                  >
                    <Badge variant="violet">
                      <Loader2 className="animate-spin" aria-hidden />
                      Đang sản xuất
                    </Badge>
                  </Link>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">{lesson.usedInVideoCount} video</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
