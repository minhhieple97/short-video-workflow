import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { ProductionRequestForm } from "@/features/productions/components/production-request-form";
import { getCatalogue } from "@/features/productions/services/catalogue.service";
import { getProductionSettings } from "@/features/productions/services/production-settings.service";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

export default async function ProduceVideosPage({ params }: Readonly<{ params: Promise<{ bookId: string }> }>) {
  const { bookId } = await params;
  const catalogue = await orNotFound(getCatalogue(bookId));

  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Sách", href: "/books" },
          { label: catalogue.book.title, href: `/books/${catalogue.book.id}?tab=lessons` },
          { label: "Sản xuất video" },
        ]}
      />
      <PageHeader
        title="Sản xuất video"
        description="Chọn các bài học cần làm video; mỗi bài học thành một video theo mạch kể tình huống → sai lầm → bài học → cách làm → hành động. Bài học được chọn tự chuyển sang Đã duyệt, và kịch bản được duyệt tự động khi máy kiểm tra đạt sau lồng tiếng, nên không cần duyệt tay."
      />
      {catalogue.lessons.length === 0 ? (
        <EmptyState
          title="Chưa có bài học"
          description="Phân tích chương hoặc tạo bài học trong tab Bài học của sách trước."
        />
      ) : (
        <ProductionRequestForm
          bookId={catalogue.book.id}
          lessons={catalogue.lessons}
          settings={getProductionSettings()}
        />
      )}
    </section>
  );
}
