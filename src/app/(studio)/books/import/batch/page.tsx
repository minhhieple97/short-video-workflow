import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { BookImportForm } from "@/features/book-imports/components/book-import-form";
import { getAppConfig } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export default function BatchImportPage() {
  const config = getAppConfig();
  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Sách", href: "/books" }, { label: "Nhập nhiều sách" }]} />
      <PageHeader
        title="Nhập nhiều sách"
        description="Tối đa 15 PDF, xử lý lần lượt và tự động tạo video cho mọi bài học."
      />
      <BookImportForm
        maxPdfBytes={config.pdf.maxSizeBytes}
        defaultRange={{
          minDurationSec: config.video.defaultMinDurationSec,
          maxDurationSec: config.video.maxDurationSec,
        }}
        defaultPace={config.video.defaultPace}
        ceilingSec={config.video.maxDurationSec}
      />
    </section>
  );
}
