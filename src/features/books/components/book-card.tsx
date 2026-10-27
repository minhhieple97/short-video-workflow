import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { BookSummary } from "../schemas/book.dto";

// Cover accents for the book spine, picked from the book id so a book keeps its color.
const SPINES = ["border-brand", "border-primary", "border-[#12a37a]", "border-[#e5446d]", "border-[#5b7bff]"] as const;

function spineFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SPINES[hash % SPINES.length] ?? SPINES[0];
}

export function BookCard({ book }: Readonly<{ book: BookSummary }>) {
  return (
    <Link
      href={`/books/${book.id}`}
      className="group bg-card shadow-card ring-border focus-visible:ring-ring/50 hover:ring-primary/40 flex gap-4 rounded-2xl p-4 ring-1 transition-shadow outline-none focus-visible:ring-3"
    >
      <div
        className={cn(
          "bg-ink flex h-24 w-16 shrink-0 items-end rounded-l-md rounded-r-xl border-l-8 p-2",
          spineFor(book.id),
        )}
        aria-hidden
      >
        <div className="bg-brand h-0.5 w-full rounded-full" />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div>
          <p className="line-clamp-2 leading-snug font-bold group-hover:underline">{book.title}</p>
          <p className="text-muted-foreground text-sm">{book.author ?? "Chưa rõ tác giả"}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="violet">{book.chapterCount} chương</Badge>
          <Badge variant="mint">{book.lessonCount} bài học</Badge>
          <Badge variant="orange">{book.videoCount} video</Badge>
        </div>
        <p className="text-muted-foreground text-xs">Nhập lúc {formatDateTime(book.createdAt)}</p>
      </div>
    </Link>
  );
}
