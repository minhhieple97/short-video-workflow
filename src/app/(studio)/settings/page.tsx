import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const STATUS_VARIANT: Record<CheckStatus, "default" | "secondary" | "destructive" | "outline"> = {
  ok: "default",
  warn: "secondary",
  error: "destructive",
  info: "outline",
};

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

export default async function SettingsPage() {
  const snapshot = await getDiagnosticsSnapshot();

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cài đặt &amp; chẩn đoán</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {snapshot.app.name} v{snapshot.app.version} · cập nhật{" "}
            {new Date(snapshot.generatedAt).toLocaleTimeString("vi-VN")}
          </p>
        </div>
        <Badge variant={snapshot.overall === "ok" ? "default" : "destructive"}>
          {snapshot.overall === "ok" ? "Hệ thống sẵn sàng" : "Hệ thống bị suy giảm"}
        </Badge>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>

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
