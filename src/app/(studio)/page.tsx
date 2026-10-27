import { Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { BookCard } from "@/features/books/components/book-card";
import { listBooks } from "@/features/books/services/book.service";

export const dynamic = "force-dynamic";

const RECENT_BOOK_COUNT = 6;

export default async function DashboardPage() {
  const books = (await listBooks()).slice(0, RECENT_BOOK_COUNT);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title="Tổng quan"
        description={
          <>
            Video và tác vụ gần đây sẽ xuất hiện ở đây khi có (M3–M5). Kiểm tra hệ thống tại{" "}
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
