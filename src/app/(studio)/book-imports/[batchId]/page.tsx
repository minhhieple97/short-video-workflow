import { PageHeader } from "@/components/layout/page-header";
import { BookImportProgress } from "@/features/book-imports/components/book-import-progress";
import { getBookImport } from "@/features/book-imports/services/book-import.service";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

export default async function BookImportPage({ params }: { params: Promise<{ batchId: string }> }) {
  const batch = await orNotFound(getBookImport((await params).batchId));
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Tiến độ nhập sách"
        description="Có thể đóng trang. Quá trình xử lý vẫn tiếp tục và tự chờ khi hết hạn mức."
      />
      <BookImportProgress initial={batch} />
    </section>
  );
}
