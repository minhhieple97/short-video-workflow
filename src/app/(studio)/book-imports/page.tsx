import { Plus } from "lucide-react";
import Link from "next/link";

import { IconButton } from "@/components/layout/icon-button";
import { PageHeader } from "@/components/layout/page-header";
import { BOOK_IMPORT_LABELS } from "@/features/book-imports/domain/book-import-status";
import { getBookImports } from "@/features/book-imports/services/book-import.service";

export const dynamic = "force-dynamic";

export default async function BookImportsPage() {
  const batches = await getBookImports();
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Các đợt nhập sách"
        actions={
          <IconButton label="Nhập sách" asChild>
            <Link href="/books/import?auto=1">
              <Plus aria-hidden />
            </Link>
          </IconButton>
        }
      />
      {batches.length ? (
        <ul className="flex flex-col gap-3">
          {batches.map((batch) => (
            <li key={batch.id}>
              <Link href={`/book-imports/${batch.id}`} className="bg-card block rounded-lg border p-4 hover:underline">
                {batch.items.length} sách · {BOOK_IMPORT_LABELS[batch.status] ?? batch.status}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Chưa có đợt nhập sách.</p>
      )}
    </section>
  );
}
