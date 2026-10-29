import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";

import type { ChapterSummary } from "../schemas/chapter.dto";
import { AnalyzeChapterButton } from "./analyze-chapter-button";
import { ChapterStatusBadge } from "./chapter-status-badge";

export function ChapterTable({
  chapters,
  emptyHint,
}: Readonly<{ chapters: readonly ChapterSummary[]; emptyHint?: string }>) {
  if (chapters.length === 0) {
    return <EmptyState title="Sách chưa có chương nào" description={emptyHint} />;
  }

  return (
    <Table className="min-w-4xl table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Chương</TableHead>
          <TableHead className="w-32 text-right">Độ dài</TableHead>
          <TableHead className="w-44">Phân tích</TableHead>
          <TableHead className="w-24 text-right">Bài học</TableHead>
          <TableHead className="w-24 text-right">Thao tác</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {chapters.map((chapter) => (
          <TableRow key={chapter.id}>
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
        ))}
      </TableBody>
    </Table>
  );
}
