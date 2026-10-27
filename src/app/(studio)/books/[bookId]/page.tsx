import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { toBookTab } from "@/features/books/components/book-tab-values";
import { BookTabs } from "@/features/books/components/book-tabs";
import { DeleteBookButton } from "@/features/books/components/delete-book-button";
import { EditBookDialog } from "@/features/books/components/edit-book-dialog";
import { getBook } from "@/features/books/services/book.service";
import { AnalyzeBookButton } from "@/features/chapters/components/analyze-book-button";
import { ChapterTable } from "@/features/chapters/components/chapter-table";
import { listChapters } from "@/features/chapters/services/chapter.service";
import { CreateLessonDialog } from "@/features/lessons/components/create-lesson-dialog";
import { LessonFilters } from "@/features/lessons/components/lesson-filters";
import { LessonTable } from "@/features/lessons/components/lesson-table";
import { lessonFilterSchema } from "@/features/lessons/schemas/lesson.schema";
import { listLessons } from "@/features/lessons/services/lesson.service";
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
  const [chapters, lessons] = await Promise.all([
    listChapters(bookId),
    listLessons(bookId, filter.success ? filter.data : {}),
  ]);
  const chapterRefs = chapters.map(({ id, order, title }) => ({ id, order, title }));

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
            <EditBookDialog book={book} />
            <DeleteBookButton book={book} />
          </>
        }
      />
      {book.description ? <p className="text-sm whitespace-pre-line">{book.description}</p> : null}

      <BookTabs
        activeTab={toBookTab(query.tab)}
        counts={{ chapters: book.chapterCount, lessons: book.lessonCount, videos: book.videoCount }}
        panels={{
          chapters: (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm">
                  Chế độ AI: <span className="text-foreground font-medium">{getAppConfig().ai.mode}</span> · phân tích
                  lần lượt từng chương, bài học tạo ra ở trạng thái nháp.
                </p>
                <AnalyzeBookButton bookId={book.id} />
              </div>
              <ChapterTable chapters={chapters} />
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
          videos: <EmptyState title="Chưa có video" description="Tạo video từ bài học đã duyệt (có ở M3)." />,
        }}
      />
    </section>
  );
}
