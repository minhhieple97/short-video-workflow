import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChapterStatusBadge } from "@/features/chapters/components/chapter-status-badge";
import { RenameChapterForm } from "@/features/chapters/components/rename-chapter-form";
import { getChapter } from "@/features/chapters/services/chapter.service";
import { formatDateTime, formatNumber } from "@/lib/format";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

export default async function ChapterPage({
  params,
}: Readonly<{ params: Promise<{ bookId: string; chapterId: string }> }>) {
  const { bookId, chapterId } = await params;
  const chapter = await orNotFound(getChapter(chapterId));
  if (chapter.book.id !== bookId) notFound();

  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Sách", href: "/books" },
          { label: chapter.book.title, href: `/books/${bookId}` },
          { label: `Chương ${chapter.order}` },
        ]}
      />
      <PageHeader
        title={chapter.title}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <ChapterStatusBadge status={chapter.analysisStatus} />
            <span>
              {formatNumber(chapter.content.length)} ký tự · {chapter.lessonCount} bài học
              {chapter.analyzedAt ? ` · Phân tích lúc ${formatDateTime(chapter.analyzedAt)}` : ""}
            </span>
          </div>
        }
      />
      <RenameChapterForm chapterId={chapter.id} title={chapter.title} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nội dung nguồn</CardTitle>
          <p className="text-muted-foreground text-xs">
            Vị trí trong sách: {chapter.sourceStartOffset ?? "?"}–{chapter.sourceEndOffset ?? "?"} · SHA-256{" "}
            {chapter.contentHash.slice(0, 12)}…
          </p>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[70vh] overflow-y-auto font-sans text-sm leading-relaxed whitespace-pre-wrap">
            {chapter.content}
          </pre>
        </CardContent>
      </Card>
    </section>
  );
}
