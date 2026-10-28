import { CheckCircle2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DriveConnectionCard } from "@/features/drive/components/drive-connection-card";
import { driveCallbackError } from "@/features/drive/domain/drive-messages";
import { getDriveOverview } from "@/features/drive/services/drive-overview.service";
import { RunTestJobButton } from "@/features/jobs/components/run-test-job-button";
import { getDiagnosticsSnapshot } from "@/server/diagnostics/get-diagnostics-snapshot";
import type { CheckResult, CheckStatus } from "@/server/diagnostics/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "Ổn",
  warn: "Cảnh báo",
  error: "Lỗi",
  info: "Thông tin",
};

const STATUS_VARIANT: Record<CheckStatus, "mint" | "amber" | "rose" | "slate"> = {
  ok: "mint",
  warn: "amber",
  error: "rose",
  info: "slate",
};

const STARTUP_STEPS = [
  { label: "Redis", command: "docker compose up -d" },
  { label: "Worker", command: "pnpm worker:dev" },
  { label: "Web (http://127.0.0.1:3000)", command: "pnpm dev" },
  { label: "Tác vụ chờ Claude CLI", command: "pnpm ai:run --list" },
  { label: "Chẩn đoán trong terminal", command: "pnpm diagnose" },
];

function CheckCard({ check }: Readonly<{ check: CheckResult }>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{check.label}</CardTitle>
          <Badge variant={STATUS_VARIANT[check.status]}>{STATUS_LABEL[check.status]}</Badge>
        </div>
        <CardDescription>{check.summary}</CardDescription>
      </CardHeader>
      {check.details ? (
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {Object.entries(check.details).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="break-all">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      ) : null}
    </Card>
  );
}

interface SettingsPageProps {
  searchParams: Promise<{ drive?: string; drive_error?: string }>;
}

export default async function SettingsPage({ searchParams }: Readonly<SettingsPageProps>) {
  const [snapshot, driveOverview, query] = await Promise.all([
    getDiagnosticsSnapshot(),
    getDriveOverview(),
    searchParams,
  ]);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title="Cài đặt & chẩn đoán"
        description={`${snapshot.app.name} v${snapshot.app.version} · cập nhật ${new Date(snapshot.generatedAt).toLocaleTimeString("vi-VN")}`}
        actions={
          <Badge variant={snapshot.overall === "ok" ? "mint" : "rose"}>
            {snapshot.overall === "ok" ? "Hệ thống sẵn sàng" : "Hệ thống bị suy giảm"}
          </Badge>
        }
      />

      {query.drive === "connected" ? (
        <Alert>
          <CheckCircle2 aria-hidden />
          <AlertTitle>Đã kết nối Google Drive</AlertTitle>
          <AlertDescription>Các bản render cuối mới sẽ được lưu lên Drive tự động.</AlertDescription>
        </Alert>
      ) : null}
      {query.drive_error ? (
        <Alert variant="destructive">
          <AlertTitle>Chưa kết nối được Google Drive</AlertTitle>
          <AlertDescription>{driveCallbackError(query.drive_error)}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="integrations-heading" className="flex flex-col gap-4">
        <h2 id="integrations-heading" className="text-lg font-bold">
          Tích hợp
        </h2>
        <DriveConnectionCard overview={driveOverview} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Khởi động trong WSL</CardTitle>
          <CardDescription>
            Mỗi lệnh một terminal WSL, chạy trong thư mục dự án trên filesystem Linux (không dùng /mnt/c).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            {STARTUP_STEPS.map((step) => (
              <div key={step.command} className="contents">
                <dt className="text-muted-foreground">{step.label}</dt>
                <dd>
                  <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{step.command}</code>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cấu hình video ngắn &amp; tài nguyên</CardTitle>
          <CardDescription>Giá trị đọc từ biến môi trường (.env), chỉ để xem.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            {snapshot.config.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="break-all">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kiểm tra hàng đợi</CardTitle>
          <CardDescription>
            Đưa một tác vụ thử vào Redis để xác nhận worker xử lý được (Next.js → Redis → worker → SQLite).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RunTestJobButton />
          <RunTestJobButton
            kind="mock-ai"
            label="Kiểm tra AI mẫu"
            successMessage="Mock AI tạo bài học và kịch bản đúng schema (không cần tài khoản Claude)."
          />
        </CardContent>
      </Card>
    </section>
  );
}
