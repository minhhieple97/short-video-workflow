import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { toBookTab } from "@/features/books/components/book-tab-values";
import { BookTabs } from "@/features/books/components/book-tabs";
import { DeleteBookButton } from "@/features/books/components/delete-book-button";
import { EditBookDialog } from "@/features/books/components/edit-book-dialog";
import { getBook } from "@/features/books/services/book.service";
import { ChapterTable } from "@/features/chapters/components/chapter-table";
import { listChapters } from "@/features/chapters/services/chapter.service";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

interface BookDetailPageProps {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function BookDetailPage({ params, searchParams }: Readonly<BookDetailPageProps>) {
  const [{ bookId }, { tab }] = await Promise.all([params, searchParams]);
  const book = await orNotFound(getBook(bookId));
  const chapters = await listChapters(bookId);

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
        activeTab={toBookTab(tab)}
        counts={{ chapters: book.chapterCount, lessons: book.lessonCount, videos: book.videoCount }}
        panels={{
          chapters: <ChapterTable chapters={chapters} />,
          lessons: (
            <EmptyState title="Chưa có bài học" description="Phân tích chương để AI đề xuất bài học (có ở M2)." />
          ),
          videos: <EmptyState title="Chưa có video" description="Tạo video từ bài học đã duyệt (có ở M3)." />,
        }}
      />
    </section>
  );
}
