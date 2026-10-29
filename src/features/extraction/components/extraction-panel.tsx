import { AlertTriangle, CheckCircle2, Circle, CircleDot, Info, Loader2, PauseCircle } from "lucide-react";

import { SegmentedProgress } from "@/components/layout/segmented-progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { formatUsd } from "../domain/ocr-budget";
import {
  EXTRACTION_STATUS_LABELS,
  extractionSteps,
  HELD_LABEL,
  type ExtractionStepState,
} from "../domain/extraction-labels";
import { extractionProgressState } from "../domain/extraction-status";
import type { ExtractionDto } from "../schemas/extraction.dto";
import { ExtractionActions } from "./extraction-actions";

const STEP_ICONS: Record<ExtractionStepState, typeof Circle> = {
  done: CheckCircle2,
  current: CircleDot,
  blocked: PauseCircle,
  todo: Circle,
};

const STEP_TONES: Record<ExtractionStepState, string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  current: "text-primary",
  blocked: "text-amber-600 dark:text-amber-400",
  todo: "text-muted-foreground",
};

const STEP_STATE_LABELS: Record<ExtractionStepState, string> = {
  done: "xong",
  current: "đang làm",
  blocked: "đang dừng",
  todo: "chưa tới",
};

function Steps({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const steps = extractionSteps({
    status: extraction.status,
    hasPages: extraction.pageCount !== null,
    held: extraction.held,
  });
  // The current step only turns while the worker still has work on it; a stopped run keeps a still marker.
  const working = extractionProgressState(extraction) === "running";
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Các bước trích xuất">
      {steps.map((step) => {
        const spinning = working && step.state === "current";
        const Icon = spinning ? Loader2 : STEP_ICONS[step.state];
        return (
          <li key={step.key} className="flex items-center gap-2 text-sm">
            <Icon className={cn("size-4 shrink-0", STEP_TONES[step.state], spinning && "animate-spin")} aria-hidden />
            <span className={step.state === "todo" ? "text-muted-foreground" : undefined}>{step.label}</span>
            <span className="sr-only">({STEP_STATE_LABELS[step.state]})</span>
          </li>
        );
      })}
    </ol>
  );
}

function PageCounts({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const { pages, pageCount } = extraction;
  if (pageCount === null) {
    return (
      <p className="text-muted-foreground text-sm">
        {extraction.status === "FAILED" || extraction.status === "CANCELLED"
          ? "Chưa đọc được số trang của PDF."
          : "Số trang sẽ hiện sau khi đọc PDF."}
      </p>
    );
  }
  const done = pages.text + pages.ocr + pages.empty;
  const unread = Math.max(0, pageCount - done - pages.waitingOcr - pages.sentToOcr - pages.failed);
  return (
    <SegmentedProgress
      label="Trang đã có chữ"
      summary={`${formatNumber(done)}/${formatNumber(pageCount)} trang`}
      done={done}
      total={pageCount}
      segments={[
        { key: "text", label: "Có chữ sẵn", value: pages.text, tone: "mint" },
        { key: "ocr", label: "Đã OCR", value: pages.ocr, tone: "blue" },
        { key: "empty", label: "Trang trống", value: pages.empty, tone: "slate" },
        { key: "sent", label: "Đang OCR", value: pages.sentToOcr, tone: "violet", active: true },
        { key: "waiting", label: "Chờ gửi OCR", value: pages.waitingOcr, tone: "amber" },
        { key: "failed", label: "Lỗi", value: pages.failed, tone: "rose" },
        { key: "unread", label: "Chưa đọc", value: unread, tone: "slate" },
      ]}
    />
  );
}

function OcrCost({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const { ocr } = extraction;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        <span className="text-muted-foreground">Chi phí OCR: </span>
        đã chi <span className="tabular-nums">{formatUsd(ocr.spentMicroUsd)}</span>
        {ocr.reservedMicroUsd > 0 ? (
          <>
            {" "}
            · đang giữ chỗ <span className="tabular-nums">{formatUsd(ocr.reservedMicroUsd)}</span>
          </>
        ) : null}
        {" · "}trần{" "}
        <span className="tabular-nums">
          {ocr.ceilingMicroUsd === null ? "chưa đặt" : formatUsd(ocr.ceilingMicroUsd)}
        </span>
      </p>
      {ocr.provider ? (
        <p className="text-muted-foreground text-xs">
          {ocr.provider} · {ocr.model}
        </p>
      ) : null}
      {ocr.openBatch ? (
        <p className="text-muted-foreground text-xs">
          Lô OCR {formatNumber(ocr.openBatch.pageCount)} trang
          {ocr.openBatch.submittedAt ? ` đã gửi lúc ${formatDateTime(ocr.openBatch.submittedAt)}` : " chưa gửi xong"}
          {ocr.openBatch.lastPolledAt ? `, kiểm tra gần nhất ${formatDateTime(ocr.openBatch.lastPolledAt)}` : ""}. Lô
          OCR theo lô có thể mất vài giờ; ứng dụng tự kiểm tra lại, không cần mở trang này.
        </p>
      ) : null}
    </div>
  );
}

function StatusMessage({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const { status, errorMessage, held, activeJob } = extraction;
  if (status === "NEEDS_CHAPTERS") {
    return (
      <Alert>
        <Info aria-hidden />
        <AlertTitle>Đã có toàn bộ chữ, chưa xác định được chương</AlertTitle>
        <AlertDescription>
          {errorMessage ?? "Không tìm thấy tiêu đề chương nào, và ứng dụng không coi cả cuốn sách là một chương."} Bấm
          “Thử lại” để hỏi NotebookLM lại sau khi đã cấu hình hoặc đăng nhập.
        </AlertDescription>
      </Alert>
    );
  }
  if (!errorMessage || status === "COMPLETED") return null;
  if (held || status === "FAILED" || status === "PARTIAL") {
    return (
      <Alert variant={status === "FAILED" ? "destructive" : "default"}>
        <AlertTriangle aria-hidden />
        <AlertTitle>{status === "PARTIAL" ? "Một số trang chưa đọc được" : "Trích xuất đang dừng"}</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  }
  if (activeJob) {
    return (
      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Sẽ thử lại tự động: {errorMessage}
      </p>
    );
  }
  return <p className="text-muted-foreground text-sm">{errorMessage}</p>;
}

// Where a PDF book's extraction stands: the four steps, a bar of real page counts per state and the OCR spend. The bar
// counts pages, never time: how long OCR takes depends on the provider's batch queue, not on anything the app measures.
export function ExtractionPanel({ extraction }: Readonly<{ extraction: ExtractionDto }>) {
  const status = extraction.held ? HELD_LABEL : EXTRACTION_STATUS_LABELS[extraction.status];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Trích xuất PDF</CardTitle>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <CardDescription>
          Chỉ những trang không có lớp chữ dùng được mới được gửi OCR. PDF gốc giữ nguyên; văn bản và chương là bản dẫn
          xuất. Bắt đầu lúc {formatDateTime(extraction.createdAt)}
          {extraction.completedAt ? `, xong lúc ${formatDateTime(extraction.completedAt)}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Steps extraction={extraction} />
        <PageCounts extraction={extraction} />
        <OcrCost extraction={extraction} />
        <StatusMessage extraction={extraction} />
        <ExtractionActions extraction={extraction} />
      </CardContent>
    </Card>
  );
}
