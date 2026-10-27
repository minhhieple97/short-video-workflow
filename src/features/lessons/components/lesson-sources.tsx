import Link from "next/link";

import { chapterLabel } from "@/features/chapters/domain/analysis-status";

import type { LessonSourceDto } from "../schemas/lesson.dto";

export function LessonSources({ bookId, sources }: Readonly<{ bookId: string; sources: readonly LessonSourceDto[] }>) {
  return (
    <ul className="flex flex-col gap-3">
      {sources.map((source) => (
        <li key={source.id} className="flex flex-col gap-1 text-sm">
          <Link href={`/books/${bookId}/chapters/${source.chapter.id}`} className="font-medium hover:underline">
            {chapterLabel(source.chapter.order, source.chapter.title)}
          </Link>
          {source.excerpt ? (
            <blockquote className="border-border text-muted-foreground border-l-2 pl-3 italic">
              “{source.excerpt}”
            </blockquote>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Chưa có trích đoạn được kiểm chứng — hãy đối chiếu với nội dung chương trước khi duyệt.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
