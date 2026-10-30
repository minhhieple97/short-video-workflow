"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage, sendJson } from "@/lib/api-client";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";

import type { DriveStorageDto } from "../schemas/drive-connection.dto";

export function DriveStorage({
  capacity,
  disabled,
}: Readonly<{ capacity: DriveStorageDto | null; disabled: boolean }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await sendJson<DriveStorageDto>("/api/integrations/drive/capacity/refresh", "POST");
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const fields = capacity
    ? ([
        ["Tổng dung lượng Google đã dùng", capacity.usageBytes],
        ["Giới hạn lưu trữ Google", capacity.limitBytes],
        ["Riêng tệp Google Drive", capacity.usageInDriveBytes],
        ["Trong thùng rác Drive", capacity.usageInDriveTrashBytes],
      ] as const)
    : [];

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Dung lượng lưu trữ từ Google</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={disabled || pending}
          aria-busy={pending}
        >
          <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
          {pending ? "Đang đọc từ Google…" : "Đọc lại từ Google"}
        </Button>
      </div>
      {capacity ? (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {fields.map(([label, bytes]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  className="text-right tabular-nums"
                  title={bytes === null ? undefined : `${formatNumber(bytes)} byte`}
                >
                  {bytes === null ? "Google không cung cấp" : formatBytes(bytes)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs">
            Đọc từ Google lúc {formatDateTime(capacity.fetchedAt)}. Tổng đã dùng bao gồm các dịch vụ Google; phần Drive
            được hiển thị riêng. Đây là dung lượng lưu trữ, không phải quota API.
          </p>
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">Số liệu gốc từ API (byte)</summary>
            <ul className="mt-2 space-y-1">
              {fields.map(([label, bytes]) => (
                <li key={label}>
                  {label}: {bytes === null ? "Google không cung cấp" : `${bytes} byte`}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Chưa đọc dung lượng từ Google. Bấm “Đọc lại từ Google” để lấy số liệu.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
