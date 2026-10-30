import { ListOrdered } from "lucide-react";
import Link from "next/link";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { IconButton } from "@/components/layout/icon-button";
import { PageHeader } from "@/components/layout/page-header";
import { ImportWizard } from "@/features/books/components/import/import-wizard";
import { getAppConfig } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export default async function ImportBookPage({ searchParams }: Readonly<{ searchParams: Promise<{ auto?: string }> }>) {
  const config = getAppConfig();
  const query = await searchParams;
  return (
    <section className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Sách", href: "/books" }, { label: "Nhập sách" }]} />
      <PageHeader
        title="Nhập sách"
        actions={
          <IconButton label="Các đợt nhập tự động" variant="outline" asChild>
            <Link href="/book-imports">
              <ListOrdered aria-hidden />
            </Link>
          </IconButton>
        }
        description="Nhập PDF, TXT hoặc Markdown. PDF hỗ trợ một hoặc nhiều sách trong cùng một lần."
      />
      <ImportWizard
        maxTextBytes={config.import.maxSizeBytes}
        initialAutomatic={query.auto === "1"}
        settings={{
          maxPdfBytes: config.pdf.maxSizeBytes,
          defaultRange: {
            minDurationSec: config.video.defaultMinDurationSec,
            maxDurationSec: config.video.maxDurationSec,
          },
          defaultPace: config.video.defaultPace,
          ceilingSec: config.video.maxDurationSec,
        }}
      />
    </section>
  );
}
