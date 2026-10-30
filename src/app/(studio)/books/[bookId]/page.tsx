import { Clapperboard } from "lucide-react";
import Link from "next/link";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { IconButton } from "@/components/layout/icon-button";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { toBookTab } from "@/features/books/components/book-tab-values";
import { BookTabs } from "@/features/books/components/book-tabs";
import { DeleteBookButton } from "@/features/books/components/delete-book-button";
import { EditBookDialog } from "@/features/books/components/edit-book-dialog";
import { getBook } from "@/features/books/services/book.service";
import { ChapterAnalysisSection } from "@/features/chapters/components/chapter-analysis-section";
import { CHAPTER_PAGE_PARAM, CHAPTER_PAGE_SIZE } from "@/features/chapters/domain/paging";
import { getBookAnalysisOverview } from "@/features/chapters/services/analysis-overview.service";
import { listChapterRefsOfBook, listChaptersPage } from "@/features/chapters/services/chapter.service";
import { ExtractionPanel } from "@/features/extraction/components/extraction-panel";
import { extractionProgressState } from "@/features/extraction/domain/extraction-status";
import { getBookExtraction } from "@/features/extraction/services/extraction-view.service";
import { CreateLessonDialog } from "@/features/lessons/components/create-lesson-dialog";
import { LessonFilters } from "@/features/lessons/components/lesson-filters";
import { LessonList } from "@/features/lessons/components/lesson-list";
import { LESSON_PAGE_PARAM, LESSON_PAGE_SIZE } from "@/features/lessons/domain/paging";
import { lessonFilterSchema } from "@/features/lessons/schemas/lesson.schema";
import { listLessons, listLessonsPage } from "@/features/lessons/services/lesson.service";
import { CreateVideoDialog } from "@/features/videos/components/create-video-dialog";
import { VideoTable } from "@/features/videos/components/video-table";
import { VIDEO_PAGE_PARAM, VIDEO_PAGE_SIZE } from "@/features/videos/domain/paging";
import { defaultDurationRange, listVideosPage } from "@/features/videos/services/video.service";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page-helpers";
import { getAppConfig } from "@/shared/config/env";
import { toPageRequest } from "@/shared/pagination";

export const dynamic = "force-dynamic";

interface BookDetailPageProps {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{
    tab?: string;
    chapter?: string;
    status?: string;
    usage?: string;
    [CHAPTER_PAGE_PARAM]?: string;
    [LESSON_PAGE_PARAM]?: string;
    [VIDEO_PAGE_PARAM]?: string;
  }>;
}

export default async function BookDetailPage({ params, searchParams }: Readonly<BookDetailPageProps>) {
  const [{ bookId }, query] = await Promise.all([params, searchParams]);
  const book = await orNotFound(getBook(bookId));
  const filter = lessonFilterSchema.safeParse({ chapterId: query.chapter, status: query.status, usage: query.usage });
  const [chapters, chapterRefs, lessons, approvedLessons, videos, extraction, analysis] = await Promise.all([
    listChaptersPage(bookId, toPageRequest(query[CHAPTER_PAGE_PARAM], CHAPTER_PAGE_SIZE)),
    listChapterRefsOfBook(bookId),
    listLessonsPage(
      bookId,
      filter.success ? filter.data : {},
      toPageRequest(query[LESSON_PAGE_PARAM], LESSON_PAGE_SIZE),
    ),
    listLessons(bookId, { status: "APPROVED" }),
    listVideosPage({ bookId }, toPageRequest(query[VIDEO_PAGE_PARAM], VIDEO_PAGE_SIZE)),
    getBookExtraction(bookId),
    getBookAnalysisOverview(bookId, book.title),
  ]);
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
            <ChapterAnalysisSection
              bookId={book.id}
              aiMode={getAppConfig().ai.mode}
              overview={analysis}
              extraction={pendingExtraction}
              chapters={chapters}
              emptyHint={
                pendingExtraction === "running"
                  ? "Đang trích xuất PDF; danh sách chương sẽ hiện khi trích xuất xong."
                  : pendingExtraction === "stopped"
                    ? "Trích xuất PDF đang dừng. Xem thẻ “Trích xuất PDF” phía trên để tiếp tục."
                    : undefined
              }
            />
          ),
          lessons: (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <LessonFilters chapters={chapterRefs} />
                <CreateLessonDialog bookId={book.id} chapters={chapterRefs} />
              </div>
              <LessonList
                bookId={book.id}
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
              <VideoTable videos={videos.items} emptyHint="Duyệt ít nhất một bài học rồi bấm “Tạo video”." />
              <Pagination page={videos} param={VIDEO_PAGE_PARAM} />
            </div>
          ),
        }}
      />
    </section>
  );
}
