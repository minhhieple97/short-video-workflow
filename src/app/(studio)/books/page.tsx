import { Plus, Search } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/layout/empty-state";
import { IconButton } from "@/components/layout/icon-button";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookCard } from "@/features/books/components/book-card";
import { listBooksPage } from "@/features/books/services/book.service";
import { toPageRequest } from "@/shared/pagination";

export const dynamic = "force-dynamic";

// Three cards to a row on wide screens, so a page is whole rows.
const BOOK_PAGE_SIZE = 12;

export default async function BooksPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ q?: string; page?: string }> }>) {
  const { q = "", page } = await searchParams;
  const books = await listBooksPage(q, toPageRequest(page, BOOK_PAGE_SIZE));

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Thư viện sách"
        description="Nhập sách một lần, tái sử dụng cho nhiều video."
        actions={
          <IconButton label="Nhập sách" asChild>
            <Link href="/books/import">
              <Plus aria-hidden />
            </Link>
          </IconButton>
        }
      />

      <form action="/books" className="flex max-w-xl gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Tìm theo tên sách hoặc tác giả" aria-label="Tìm sách" />
        <Button type="submit" variant="outline">
          <Search aria-hidden />
          Tìm
        </Button>
      </form>

      {books.total === 0 ? (
        <EmptyState
          title={q ? "Không có sách phù hợp" : "Chưa có sách nào"}
          description={q ? "Thử từ khoá khác (không cần gõ dấu)." : "Nhập PDF, TXT hoặc Markdown để bắt đầu."}
          action={
            q ? (
              <Button asChild variant="outline">
                <Link href="/books">Xoá bộ lọc</Link>
              </Button>
            ) : (
              <IconButton label="Nhập sách đầu tiên" asChild>
                <Link href="/books/import">
                  <Plus aria-hidden />
                </Link>
              </IconButton>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {books.items.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
          <Pagination page={books} />
        </>
      )}
    </section>
  );
}
