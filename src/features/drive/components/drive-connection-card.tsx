"use client";

import { CloudOff, ExternalLink, LogIn, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage, sendJson } from "@/lib/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";

import type { DriveAuthorizationDto, DriveDisconnectDto, DriveOverviewDto } from "../schemas/drive-connection.dto";

function Meter({
  label,
  used,
  max,
  format,
}: Readonly<{ label: string; used: number; max: number; format: (value: number) => string }>) {
  const percent = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {format(used)} / {format(max)}
        </span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div className={percent >= 90 ? "h-full bg-red-500" : "bg-primary h-full"} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function DriveConnectionCard({ overview }: Readonly<{ overview: DriveOverviewDto }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { connection, usage, capacity } = overview;

  async function connect(): Promise<void> {
    setPending(true);
    try {
      const { authorizationUrl } = await sendJson<DriveAuthorizationDto>("/api/integrations/drive/connect", "POST");
      // Google's sign-in page sends the browser back to this app when the user is done.
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  }

  async function disconnect(): Promise<void> {
    setPending(true);
    try {
      const result = await sendJson<DriveDisconnectDto>("/api/integrations/drive/disconnect", "POST");
      if (result.revokedAtGoogle) toast.success("Đã ngắt kết nối Google Drive.");
      else
        toast.warning("Đã ngắt kết nối trong ứng dụng, nhưng không liên lạc được Google để thu hồi quyền.", {
          description: "Bạn có thể gỡ quyền của ứng dụng trong trang Tài khoản Google > Bảo mật.",
          duration: 15_000,
        });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const status = !connection.configured
    ? { label: "Chưa cấu hình", tone: "slate" as const }
    : connection.needsReconnect
      ? { label: "Cần kết nối lại", tone: "amber" as const }
      : connection.connected
        ? { label: "Đã kết nối", tone: "mint" as const }
        : { label: "Chưa kết nối", tone: "slate" as const };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Google Drive</CardTitle>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <CardDescription>
          Lưu mỗi bản render cuối, kèm script.json và manifest.json, vào thư mục “Book Video Studio” trên Drive của bạn.
          Ứng dụng chỉ xin quyền với tệp do chính nó tạo (drive.file) và không bao giờ xoá gì trên Drive.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!connection.configured ? (
          <p className="text-sm">
            Tạo OAuth client loại <strong>Desktop app</strong> trong Google Cloud project của bạn (bật Google Drive
            API), rồi đặt <code className="bg-muted rounded px-1">GOOGLE_OAUTH_CLIENT_ID</code> và{" "}
            <code className="bg-muted rounded px-1">GOOGLE_OAUTH_CLIENT_SECRET</code> trong .env và khởi động lại.
          </p>
        ) : null}

        {connection.connected || connection.needsReconnect ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Tài khoản</dt>
            <dd>{connection.accountEmail ?? "(Google không cho biết email)"}</dd>
            {connection.connectedAt ? (
              <>
                <dt className="text-muted-foreground">Kết nối lúc</dt>
                <dd>{formatDateTime(connection.connectedAt)}</dd>
              </>
            ) : null}
          </dl>
        ) : null}

        {connection.needsReconnect ? (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            Google không còn chấp nhận quyền truy cập (đã thu hồi, đổi mật khẩu, hoặc refresh token hết hạn sau 7 ngày
            khi dự án OAuth để chế độ Testing). Việc lưu Drive đang dừng cho tới khi bạn kết nối lại.
          </p>
        ) : null}

        {connection.connected ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Meter
              label="Yêu cầu Drive của ứng dụng (24 giờ)"
              used={usage.requests}
              max={usage.maxRequests}
              format={String}
            />
            <Meter
              label="Dữ liệu ứng dụng đã gửi (24 giờ)"
              used={usage.bytesSent}
              max={usage.maxBytes}
              format={formatBytes}
            />
            {capacity?.limitBytes ? (
              <div className="sm:col-span-2">
                <Meter
                  label="Dung lượng Drive đã dùng"
                  used={capacity.usageBytes}
                  max={capacity.limitBytes}
                  format={formatBytes}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Theo lần đọc gần nhất lúc {formatDateTime(capacity.fetchedAt)}; đây là dung lượng lưu trữ, không phải
                  quota của Drive API.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {overview.failedArchives > 0 ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {overview.failedArchives} bản render lưu Drive bị lỗi; thử lại trong trang Render của từng video.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {connection.configured && !connection.connected ? (
            <Button onClick={() => void connect()} disabled={pending}>
              <LogIn aria-hidden />
              {connection.needsReconnect ? "Kết nối lại Google Drive" : "Kết nối Google Drive"}
            </Button>
          ) : null}
          {connection.connected || connection.needsReconnect ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={pending}>
                  <Unplug aria-hidden />
                  Ngắt kết nối
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ngắt kết nối Google Drive?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Ứng dụng sẽ thu hồi quyền ở Google và quên kết nối. Các tệp đã lưu vẫn ở nguyên trên Drive của bạn;
                    việc lưu bản render mới dừng cho tới khi bạn kết nối lại.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Không</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void disconnect()}>Ngắt kết nối</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button asChild variant="ghost">
            <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
              Quyền ứng dụng trong tài khoản Google
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
