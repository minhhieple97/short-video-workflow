import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RunTestJobButton } from "@/features/jobs/components/run-test-job-button";
import { formatDateTime } from "@/lib/format";

import type { NotebookLmOverviewDto, NotebookLmUsageWindowDto } from "../schemas/notebooklm-status.dto";

const WINDOW_LABELS: Record<string, string> = {
  rolling: "Hạn mức ngắn hạn",
  weekly: "Hạn mức tuần",
};

function UsageWindow({ window }: Readonly<{ window: NotebookLmUsageWindowDto }>) {
  const label = WINDOW_LABELS[window.window] ?? "Hạn mức";
  const used = window.percentUsed;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{used === null ? "không rõ" : `đã dùng ${Math.round(used)}%`}</span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used ?? undefined}
      >
        {used === null ? null : (
          <div
            className={used >= 90 ? "h-full bg-red-500" : "bg-primary h-full"}
            style={{ width: `${Math.min(100, used)}%` }}
          />
        )}
      </div>
      {window.resetsAt ? (
        <p className="text-muted-foreground text-xs">Đặt lại lúc {formatDateTime(window.resetsAt)}</p>
      ) : null}
    </div>
  );
}

// NotebookLM as the worker last found it. The web never starts the MCP server itself; "Kiểm tra" asks the worker to.
export function NotebookLmCard({ overview }: Readonly<{ overview: NotebookLmOverviewDto }>) {
  const { last } = overview;
  const status = !overview.enabled
    ? { label: "Chưa dùng", tone: "slate" as const }
    : !last
      ? { label: "Chưa kiểm tra", tone: "amber" as const }
      : last.state === "OK"
        ? { label: "Đã đăng nhập", tone: "mint" as const }
        : last.state === "NEEDS_LOGIN"
          ? { label: "Cần đăng nhập", tone: "amber" as const }
          : { label: "Lỗi", tone: "rose" as const };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">NotebookLM</CardTitle>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <CardDescription>
          Xác định chương và lập danh mục bài học cho sách PDF, viết bản thảo cho video sản xuất hàng loạt. Worker chạy
          notebooklm-mcp-cli bằng profile bạn đã đăng nhập; ứng dụng không lưu cookie hay token nào.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!overview.enabled ? (
          <p className="text-sm">
            {overview.aiMode !== "cli-auto"
              ? `NotebookLM chỉ được dùng khi AI_MODE=cli-auto (hiện là ${overview.aiMode}).`
              : "Chưa đặt NOTEBOOKLM_PROFILE."}{" "}
            Đăng nhập một lần trong terminal:{" "}
            <code className="bg-muted rounded px-1">uvx --from notebooklm-mcp-cli nlm login --profile &lt;tên&gt;</code>
            , rồi đặt tên đó vào <code className="bg-muted rounded px-1">NOTEBOOKLM_PROFILE</code> trong .env và khởi
            động lại worker.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Profile</dt>
              <dd>{overview.profile}</dd>
              {last ? (
                <>
                  <dt className="text-muted-foreground">Kiểm tra lúc</dt>
                  <dd>{formatDateTime(last.checkedAt)}</dd>
                  {last.tier ? (
                    <>
                      <dt className="text-muted-foreground">Gói</dt>
                      <dd>{last.tier}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
            </dl>
            {last && last.state !== "OK" ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {last.message}{" "}
                {last.state === "NEEDS_LOGIN"
                  ? `Chạy lại \`nlm login --profile ${overview.profile ?? ""}\` trong terminal của bạn rồi kiểm tra lại.`
                  : null}
              </p>
            ) : null}
            {last && last.state === "OK" && last.windows.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {last.windows.map((window) => (
                  <UsageWindow key={window.window} window={window} />
                ))}
              </div>
            ) : null}
            <RunTestJobButton
              kind="notebooklm"
              label="Kiểm tra NotebookLM"
              successMessage="NotebookLM dùng được với profile đã cấu hình."
              maxAttempts={60}
              refreshWhenDone
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
