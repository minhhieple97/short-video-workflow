"use client";

import Link from "next/link";
import { ArrowUpFromLine, ListOrdered, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/layout/icon-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DurationRangePicker } from "@/features/videos/components/duration-range-picker";
import { PaceSelect } from "@/features/videos/components/pace-select";
import type { DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";
import { ApiError, errorMessage, sendJson } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { uploadFile } from "@/lib/upload-file";

import type { BookImportDto, PdfImportSettings } from "../schemas/book-import.dto";

export function BookImportForm({
  files,
  settings,
  onBusyChange,
  onLockChange,
  range,
  pace,
  onRangeChange,
  onPaceChange,
}: Readonly<{
  files: File[];
  settings: PdfImportSettings;
  onBusyChange: (busy: boolean) => void;
  onLockChange: (locked: boolean) => void;
  range: DurationRange;
  pace: Pace;
  onRangeChange: (range: DurationRange) => void;
  onPaceChange: (pace: Pace) => void;
}>) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [batch, setBatch] = useState<BookImportDto | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(): Promise<void> {
    setPending(true);
    onBusyChange(true);
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    try {
      const created = await sendJson<BookImportDto>("/api/book-imports", "POST", {
        idempotencyKey: key,
        fileNames: files.map((file) => file.name),
        ...range,
        pace,
      });
      setBatch(created);
      onLockChange(true);
      for (const item of created.items) {
        if (item.bookId) continue;
        const file = files[item.position - 1];
        if (!file) throw new Error("Thiếu tệp đã chọn. Hãy mở lại đợt nhập.");
        setProgress(`Đang tải sách ${item.position}/${files.length}: ${file.name}`);
        try {
          await uploadFile(`/api/book-imports/${created.id}/files/${item.id}`, file, controller.signal, (sent, total) =>
            setProgress(`Sách ${item.position}/${files.length}: ${formatBytes(sent)} / ${formatBytes(total)}`),
          );
        } catch (failure) {
          if (!(failure instanceof ApiError) || failure.status >= 500) throw failure;
        }
      }
      setProgress("Đang đưa sách vào hàng đợi…");
      await sendJson(`/api/book-imports/${created.id}`, "POST", { action: "start" });
      router.push(`/book-imports/${created.id}`);
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(errorMessage(failure));
      setPending(false);
      onBusyChange(false);
      setProgress("");
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-5"
    >
      <p className="text-muted-foreground text-sm">
        Mỗi bài học được tạo thành một video. Sách xử lý lần lượt; khi hết hạn mức, hệ thống sẽ chờ và tự tiếp tục.
      </p>
      <h3 className="text-sm font-semibold">Thời lượng mỗi video</h3>
      <DurationRangePicker
        id="batch-duration"
        value={range}
        onChange={onRangeChange}
        ceilingSec={settings.ceilingSec}
        disabled={pending || batch !== null}
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Nhịp độ đọc</h3>
        <PaceSelect id="batch-pace" value={pace} onChange={onPaceChange} disabled={pending || batch !== null} />
      </div>
      <p className="text-muted-foreground text-xs">
        Giữ trang mở đến khi tải đủ tệp. Sau đó, bạn có thể đóng trang và theo dõi trong các đợt nhập tự động.
      </p>
      {progress ? (
        <p role="status" className="text-sm wrap-break-word">
          {progress}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <IconButton
          type="submit"
          label={`Nhập và tự động làm video cho ${files.length} sách`}
          disabled={files.length === 0 || pending}
          aria-busy={pending}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUpFromLine aria-hidden />}
        </IconButton>
        <span className="text-muted-foreground self-center text-sm">
          {batch ? "Tiếp tục đợt nhập tự động" : `Nhập ${files.length} sách và tạo video tự động`}
        </span>
        {pending ? (
          <IconButton type="button" label="Dừng tải tệp" variant="outline" onClick={() => request.current?.abort()}>
            <X aria-hidden />
          </IconButton>
        ) : null}
        {batch ? (
          <IconButton label="Xem đợt nhập" variant="outline" asChild>
            <Link href={`/book-imports/${batch.id}`}>
              <ListOrdered aria-hidden />
            </Link>
          </IconButton>
        ) : null}
      </div>
    </form>
  );
}
