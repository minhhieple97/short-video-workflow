import { CircleAlert, CircleCheck, CircleSlash, Loader } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/layout/stat-tile";
import { Badge } from "@/components/ui/badge";
import { JobsAutoRefresh } from "@/features/jobs/components/jobs-auto-refresh";
import { CancelProductionButton, RetryProductionButton } from "@/features/productions/components/production-actions";
import { ProductionItemList } from "@/features/productions/components/production-item-list";
import { BATCH_STATUS_LABELS } from "@/features/productions/domain/production-labels";
import { getProductionView } from "@/features/productions/services/production-view.service";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/server/http/page-helpers";

export const dynamic = "force-dynamic";

export default async function ProductionPage({ params }: Readonly<{ params: Promise<{ productionId: string }> }>) {
  const { productionId } = await params;
  const production = await orNotFound(getProductionView(productionId));
  const status = BATCH_STATUS_LABELS[production.status];
  const retryable = production.counts.FAILED + production.counts.CANCELLED;

  return (
    <section className="flex flex-col gap-6">
      <JobsAutoRefresh active={production.inProgress || production.archiving} />
      <Breadcrumbs
        items={[
          { label: "Sản xuất", href: "/productions" },
          { label: production.book.title, href: `/books/${production.book.id}` },
          { label: formatDateTime(production.createdAt) },
        ]}
      />
      <PageHeader
        title={`Sản xuất ${production.items.length} video`}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.tone}>{status.label}</Badge>
            <span>
              {production.book.title} · Short {production.targetDurationSec}s · tạo lúc{" "}
              {formatDateTime(production.createdAt)}
            </span>
          </div>
        }
        actions={
          <>
            {retryable > 0 ? <RetryProductionButton productionId={production.id} /> : null}
            {production.inProgress ? <CancelProductionButton productionId={production.id} /> : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Đang chạy / chờ"
          value={production.counts.PENDING + production.counts.RUNNING + production.counts.WAITING}
          icon={Loader}
          tone="violet"
        />
        <StatTile label="Hoàn tất" value={production.counts.COMPLETED} icon={CircleCheck} tone="mint" />
        <StatTile label="Lỗi" value={production.counts.FAILED} icon={CircleAlert} tone="rose" />
        <StatTile label="Đã huỷ" value={production.counts.CANCELLED} icon={CircleSlash} tone="slate" />
      </div>
      {production.inProgress ? (
        <p className="text-muted-foreground text-sm">
          Trang tự cập nhật trong lúc worker xử lý; các video chạy lần lượt từng cái.
        </p>
      ) : null}
      <ProductionItemList productionId={production.id} items={production.items} />
    </section>
  );
}
