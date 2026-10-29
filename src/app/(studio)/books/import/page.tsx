import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { ImportWizard } from "@/features/books/components/import/import-wizard";
import { getAppConfig } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export default function ImportBookPage() {
  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Sách", href: "/books" }, { label: "Nhập sách" }]} />
      <PageHeader
        title="Nhập sách"
        actions={
          <>
            <Link href="/books/import/batch" className="text-sm font-medium underline">
              Nhập nhiều PDF tự động
            </Link>
            <Link href="/book-imports" className="text-sm underline">
              Các đợt nhập sách
            </Link>
          </>
        }
        description="Tải lên tệp .md/.txt hoặc dán văn bản, kiểm tra danh sách chương rồi xác nhận; sách PDF được trích xuất trong nền."
      />
      <ImportWizard maxPdfBytes={getAppConfig().pdf.maxSizeBytes} />
    </section>
  );
}
import Link from "next/link";
