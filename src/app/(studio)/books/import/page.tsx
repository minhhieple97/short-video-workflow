import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { ImportWizard } from "@/features/books/components/import/import-wizard";

export default function ImportBookPage() {
  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Sách", href: "/books" }, { label: "Nhập sách" }]} />
      <PageHeader
        title="Nhập sách"
        description="Tải lên tệp .md/.txt hoặc dán văn bản, kiểm tra danh sách chương rồi xác nhận."
      />
      <ImportWizard />
    </section>
  );
}
