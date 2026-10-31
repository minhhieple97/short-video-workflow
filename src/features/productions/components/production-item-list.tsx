import { Check, ExternalLink, Loader, X } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ARCHIVE_STATUS_LABELS, toArchiveStatus } from "@/features/archive/domain/archive-labels";
import { formatPreset } from "@/features/videos/domain/duration";
import { cn } from "@/lib/utils";

import { ITEM_STATUS_LABELS, PRODUCTION_STEP_LABELS } from "../domain/production-labels";
import { describeProductionStep, productionSteps, type StepState } from "../domain/production-progress";
import type { ProductionItemViewDto } from "../schemas/production-view.dto";
import { CancelProductionButton, RetryProductionButton } from "./production-actions";

const RENDER_LABELS: Record<string, string> = {
  QUEUED: "Render đang chờ",
  RENDERING: "Đang render",
  COMPLETED: "Đã render",
  FAILED: "Render lỗi",
  CANCELLED: "Render đã huỷ",
};

// The step that replaces the scenes of the video; until then it keeps what an earlier pass wrote.
const APPLY_STEP_LABEL = PRODUCTION_STEP_LABELS[2];

const STEP_STYLE: Record<StepState, string> = {
  done: "bg-tone-mint text-tone-mint-foreground",
  current: "bg-tone-violet text-tone-violet-foreground",
  stopped: "bg-tone-rose text-tone-rose-foreground",
  todo: "bg-muted text-muted-foreground",
};

const STEP_STATE_TEXT: Record<StepState, string> = {
  done: "đã xong",
  current: "đang ở bước này",
  stopped: "dừng ở bước này",
  todo: "chưa tới",
};

function StepMark({ state, number, running }: Readonly<{ state: StepState; number: number; running: boolean }>) {
  const Icon = state === "done" ? Check : state === "stopped" ? X : state === "current" && running ? Loader : null;
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        STEP_STYLE[state],
      )}
    >
      {Icon ? <Icon className={cn("size-3.5", Icon === Loader && "animate-spin")} /> : number}
    </span>
  );
}

function StepProgress({ item }: Readonly<{ item: ProductionItemViewDto }>) {
  const steps = productionSteps(item.checkpoint, item.status);
  const summary = describeProductionStep(item.checkpoint, item.status);
  return (
    <div className="flex flex-col gap-2">
      <ol className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Các bước sản xuất">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 items-center gap-2">
            <StepMark state={step.state} number={index + 1} running={item.status === "RUNNING"} />
            <span
              className={cn("truncate text-xs", step.state === "todo" ? "text-muted-foreground" : "font-medium")}
              title={step.label}
            >
              {step.label}
              <span className="sr-only"> ({STEP_STATE_TEXT[step.state]})</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm font-medium">{summary}</p>
    </div>
  );
}

function EarlierPassNote({ item }: Readonly<{ item: ProductionItemViewDto }>) {
  const content = item.earlierPass;
  if (!content) return null;
  return (
    <p className="text-muted-foreground bg-muted/60 rounded-lg px-3 py-2 text-xs">
      Video vẫn giữ kịch bản v{content.scriptVersion} · {content.sceneCount} cảnh · {content.voicedSceneCount}/
      {content.sceneCount} cảnh có giọng đọc từ trước. Phần này chỉ được thay khi đợt sản xuất chạy lại tới bước &ldquo;
      {APPLY_STEP_LABEL}&rdquo;.
    </p>
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
              {item.correction ? (
                <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                  <span>{item.correction}</span>
                  {item.correctionNote ? (
                    <span className="line-clamp-2 wrap-break-word" title={item.correctionNote}>
                      Lý do: {item.correctionNote}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <EarlierPassNote item={item} />
              {item.proposedDuration ? (
                <p className="text-muted-foreground text-xs">
                  AI đề xuất {formatPreset(item.proposedDuration.seconds)}: {item.proposedDuration.reason}
                </p>
              ) : null}
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
              {item.archive?.videoUrl ? (
                <a
                  href={item.archive.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Video trên Drive
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
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
