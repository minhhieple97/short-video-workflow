import { Clapperboard } from "lucide-react";
import Link from "next/link";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { IconButton } from "@/components/layout/icon-button";
import { PageHeader } from "@/components/layout/page-header";
import { toBookTab } from "@/features/books/components/book-tab-values";
import { BookTabs } from "@/features/books/components/book-tabs";
import { DeleteBookButton } from "@/features/books/components/delete-book-button";
import { EditBookDialog } from "@/features/books/components/edit-book-dialog";
import { getBook } from "@/features/books/services/book.service";
import { BookAnalysisPanel } from "@/features/chapters/components/book-analysis-panel";
import { ChapterTable } from "@/features/chapters/components/chapter-table";
import { getBookAnalysisOverview } from "@/features/chapters/services/analysis-overview.service";
import { listChapters } from "@/features/chapters/services/chapter.service";
import { ExtractionPanel } from "@/features/extraction/components/extraction-panel";
import { extractionProgressState } from "@/features/extraction/domain/extraction-status";
import { getBookExtraction } from "@/features/extraction/services/extraction-view.service";
import { CreateLessonDialog } from "@/features/lessons/components/create-lesson-dialog";
import { LessonFilters } from "@/features/lessons/components/lesson-filters";
import { LessonTable } from "@/features/lessons/components/lesson-table";
import { lessonFilterSchema } from "@/features/lessons/schemas/lesson.schema";
import { listLessons } from "@/features/lessons/services/lesson.service";
import { CreateVideoDialog } from "@/features/videos/components/create-video-dialog";
import { VideoTable } from "@/features/videos/components/video-table";
import { defaultDurationRange, listVideos } from "@/features/videos/services/video.service";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page-helpers";
import { getAppConfig } from "@/shared/config/env";

export const dynamic = "force-dynamic";

interface BookDetailPageProps {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ tab?: string; chapter?: string; status?: string; usage?: string }>;
}

export default async function BookDetailPage({ params, searchParams }: Readonly<BookDetailPageProps>) {
  const [{ bookId }, query] = await Promise.all([params, searchParams]);
  const book = await orNotFound(getBook(bookId));
  const filter = lessonFilterSchema.safeParse({ chapterId: query.chapter, status: query.status, usage: query.usage });
  const [chapters, lessons, approvedLessons, videos, extraction, analysis] = await Promise.all([
    listChapters(bookId),
    listLessons(bookId, filter.success ? filter.data : {}),
    listLessons(bookId, { status: "APPROVED" }),
    listVideos({ bookId }),
    getBookExtraction(bookId),
    getBookAnalysisOverview(bookId, book.title),
  ]);
  const chapterRefs = chapters.map(({ id, order, title }) => ({ id, order, title }));
  const pendingExtraction = extractionProgressState(extraction);
  // Producing needs lessons, which come from analysed chapters; until then the button says why it is off.
  const produceBlocked =
    book.lessonCount > 0
      ? null
      : pendingExtraction
        ? "Chờ trích xuất PDF xong và phân tích chương để có bài học."
        : "Chưa có bài học. Hãy phân tích chương ở tab Chương trước.";

  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Sách", href: "/books" }, { label: book.title }]} />
      <PageHeader
        title={book.title}
        description={
          <>
            <p>{book.author ?? "Chưa rõ tác giả"}</p>
            <p className="text-xs">
              Tệp gốc: {book.sourceFileName} · Nhập lúc {formatDateTime(book.createdAt)}
            </p>
          </>
        }
        actions={
          <>
            {produceBlocked ? (
              <IconButton disabled label="Sản xuất video" note={produceBlocked}>
                <Clapperboard aria-hidden />
              </IconButton>
            ) : (
              <IconButton asChild label="Sản xuất video">
                <Link href={`/books/${book.id}/produce`}>
                  <Clapperboard aria-hidden />
                </Link>
              </IconButton>
            )}
            <EditBookDialog book={book} />
            <DeleteBookButton book={book} />
          </>
        }
      />
      {book.description ? (
        <p className="max-w-3xl text-sm wrap-break-word whitespace-pre-line">{book.description}</p>
      ) : null}
      {extraction ? <ExtractionPanel extraction={extraction} /> : null}

      <BookTabs
        activeTab={toBookTab(query.tab)}
        counts={{ chapters: book.chapterCount, lessons: book.lessonCount, videos: book.videoCount }}
        panels={{
          chapters: (
            <div className="flex flex-col gap-4">
              <BookAnalysisPanel
                bookId={book.id}
                aiMode={getAppConfig().ai.mode}
                overview={analysis}
                extraction={pendingExtraction}
              />
              <ChapterTable
                chapters={chapters}
                emptyHint={
                  pendingExtraction === "running"
                    ? "Đang trích xuất PDF; danh sách chương sẽ hiện khi trích xuất xong."
                    : pendingExtraction === "stopped"
                      ? "Trích xuất PDF đang dừng. Xem thẻ “Trích xuất PDF” phía trên để tiếp tục."
                      : undefined
                }
              />
            </div>
          ),
          lessons: (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <LessonFilters chapters={chapterRefs} />
                <CreateLessonDialog bookId={book.id} chapters={chapterRefs} />
              </div>
              <LessonTable
                lessons={lessons}
                emptyHint="Phân tích chương ở tab Chương để AI đề xuất bài học, hoặc tạo bài học thủ công."
              />
            </div>
          ),
          videos: (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  {approvedLessons.length} bài học đã duyệt có thể dùng để tạo video ngắn 9:16.
                </p>
                <CreateVideoDialog
                  bookId={book.id}
                  lessons={approvedLessons.map(({ id, title, usedInVideoCount }) => ({ id, title, usedInVideoCount }))}
                  defaultRange={defaultDurationRange()}
                  defaultPace={getAppConfig().video.defaultPace}
                  ceilingSec={getAppConfig().video.maxDurationSec}
                />
              </div>
              <VideoTable videos={videos} emptyHint="Duyệt ít nhất một bài học rồi bấm “Tạo video”." />
            </div>
          ),
        }}
      />
    </section>
  );
}
