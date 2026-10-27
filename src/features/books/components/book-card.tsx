import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

import type { BookSummary } from "../schemas/book.dto";

export function BookCard({ book }: Readonly<{ book: BookSummary }>) {
  return (
    <Link
      href={`/books/${book.id}`}
      className="focus-visible:ring-ring/50 rounded-xl outline-none focus-visible:ring-3"
    >
      <Card className="hover:border-foreground/30 h-full transition-colors">
        <CardHeader>
          <CardTitle className="line-clamp-2 text-base">{book.title}</CardTitle>
          <CardDescription>{book.author ?? "Chưa rõ tác giả"}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>
            {book.chapterCount} chương · {book.lessonCount} bài học · {book.videoCount} video
          </p>
          <p className="text-xs">Nhập lúc {formatDateTime(book.createdAt)}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
