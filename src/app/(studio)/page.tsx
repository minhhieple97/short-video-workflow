import { Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/features/books/components/book-card";
import { listBooks } from "@/features/books/services/book.service";
import { VideoTable } from "@/features/videos/components/video-table";
import { listVideos } from "@/features/videos/services/video.service";

export const dynamic = "force-dynamic";

const RECENT_BOOK_COUNT = 6;
const RECENT_VIDEO_COUNT = 5;

export default async function DashboardPage() {
  const [allBooks, allVideos] = await Promise.all([listBooks(), listVideos()]);
  const books = allBooks.slice(0, RECENT_BOOK_COUNT);
  const videos = allVideos.slice(0, RECENT_VIDEO_COUNT);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title="Tổng quan"
        description={
          <>
            Sách và video gần đây. Kiểm tra hệ thống tại{" "}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              Cài đặt
            </Link>
            .
          </>
        }
        actions={
          <Button asChild>
            <Link href="/books/import">
              <Plus aria-hidden />
              Nhập sách
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Video gần đây</h2>
          <Link href="/videos" className="text-muted-foreground text-sm hover:underline">
            Xem tất cả
          </Link>
        </div>
        <VideoTable videos={videos} showBook emptyHint="Duyệt bài học trong một cuốn sách rồi tạo video." />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Sách gần đây</h2>
          <Link href="/books" className="text-muted-foreground text-sm hover:underline">
            Xem tất cả
          </Link>
        </div>
        {books.length === 0 ? (
          <EmptyState title="Chưa có sách nào" description="Nhập tệp .md hoặc .txt để bắt đầu." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
