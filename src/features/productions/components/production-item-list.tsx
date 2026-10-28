import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ARCHIVE_STATUS_LABELS, toArchiveStatus } from "@/features/archive/domain/archive-labels";

import { ITEM_STATUS_LABELS, productionStep } from "../domain/production-labels";
import type { ProductionItemViewDto } from "../schemas/production-view.dto";
import { CancelProductionButton, RetryProductionButton } from "./production-actions";

const RENDER_LABELS: Record<string, string> = {
  QUEUED: "Render đang chờ",
  RENDERING: "Đang render",
  COMPLETED: "Đã render",
  FAILED: "Render lỗi",
  CANCELLED: "Render đã huỷ",
};

function StepProgress({ item }: Readonly<{ item: ProductionItemViewDto }>) {
  const step = productionStep(item.checkpoint);
  return (
    <div className="flex flex-col gap-1">
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label={`Bước ${step.done} trên ${step.total}`}
        aria-valuemin={0}
        aria-valuemax={step.total}
        aria-valuenow={step.done}
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${(step.done / step.total) * 100}%` }} />
      </div>
      <span className="text-muted-foreground text-xs">
        {step.done}/{step.total} bước{item.status === "COMPLETED" ? "" : ` · tiếp theo: ${step.label}`}
      </span>
    </div>
  );
}

export function ProductionItemList({
  productionId,
  items,
}: Readonly<{ productionId: string; items: readonly ProductionItemViewDto[] }>) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => {
        const status = ITEM_STATUS_LABELS[item.status];
        const archive = item.archive ? ARCHIVE_STATUS_LABELS[toArchiveStatus(item.archive.status)] : null;
        return (
          <li
            key={item.id}
            className="bg-card shadow-card flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-sm tabular-nums">#{item.position}</span>
                <span className="font-semibold">{item.lessonTitle}</span>
                <Badge variant={status.tone}>{status.label}</Badge>
                {item.render ? (
                  <Badge variant="outline">{RENDER_LABELS[item.render.status] ?? item.render.status}</Badge>
                ) : null}
                {archive ? <Badge variant={archive.tone}>{archive.label}</Badge> : null}
              </div>
              <StepProgress item={item} />
              {item.reason ? (
                <p
                  className={
                    item.status === "FAILED"
                      ? "text-sm text-red-600 dark:text-red-400"
                      : "text-muted-foreground text-sm"
                  }
                >
                  {item.reason}
                </p>
              ) : null}
              {item.correction ? <p className="text-muted-foreground text-xs">{item.correction}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.videoId ? (
                <Link href={`/videos/${item.videoId}`} className="text-sm font-medium hover:underline">
                  Mở video
                </Link>
              ) : null}
              {item.render?.status === "COMPLETED" && item.videoId ? (
                <Link href={`/videos/${item.videoId}/render`} className="text-sm font-medium hover:underline">
                  Bản render
                </Link>
              ) : null}
              {item.archive?.folderUrl ? (
                <a
                  href={item.archive.folderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Thư mục Drive
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
              {item.canRetry ? <RetryProductionButton productionId={productionId} itemId={item.id} size="sm" /> : null}
              {item.canCancel ? (
                <CancelProductionButton productionId={productionId} itemId={item.id} size="sm" />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
