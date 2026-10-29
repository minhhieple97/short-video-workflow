import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { LessonSummary } from "../schemas/lesson.dto";
import { LessonOriginBadge, LessonStatusBadge } from "./lesson-badges";

export function LessonTable({
  lessons,
  emptyHint,
}: Readonly<{ lessons: readonly LessonSummary[]; emptyHint: string }>) {
  if (lessons.length === 0) return <EmptyState title="Không có bài học phù hợp" description={emptyHint} />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bài học</TableHead>
          <TableHead>Chương nguồn</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="text-right">Đã dùng</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lessons.map((lesson) => (
          <TableRow key={lesson.id}>
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
              </div>
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">{lesson.usedInVideoCount} video</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
