"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DurationRangePicker } from "@/features/videos/components/duration-range-picker";
import { PaceSelect } from "@/features/videos/components/pace-select";
import type { DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";
import { ApiError, apiRequest, errorMessage, sendJson } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";

import type { BookImportDto } from "../schemas/book-import.dto";
import { MAX_BOOKS_PER_IMPORT } from "../schemas/book-import.schema";

export function BookImportForm({
  maxPdfBytes,
  defaultRange,
  defaultPace,
  ceilingSec,
}: Readonly<{
  maxPdfBytes: number;
  defaultRange: DurationRange;
  defaultPace: Pace;
  ceilingSec: number;
}>) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [range, setRange] = useState(defaultRange);
  const [pace, setPace] = useState(defaultPace);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [batch, setBatch] = useState<BookImportDto | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function choose(next: File[]): void {
    setError(null);
    if (next.length > MAX_BOOKS_PER_IMPORT) {
      setError("Tối đa 15 tệp PDF mỗi đợt.");
      setFiles([]);
      return;
    }
    const invalid = next.find((file) => !/\.pdf$/i.test(file.name) || file.size > maxPdfBytes || file.size === 0);
    if (invalid) {
      setError(`Tệp “${invalid.name}” cần là PDF không rỗng, tối đa ${formatBytes(maxPdfBytes)}.`);
      setFiles([]);
      return;
    }
    setFiles(next);
    setKey(crypto.randomUUID());
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const created = await sendJson<BookImportDto>("/api/book-imports", "POST", {
        idempotencyKey: key,
        fileNames: files.map((file) => file.name),
        ...range,
        pace,
      });
      setBatch(created);
      for (const item of created.items) {
        if (item.bookId) continue;
        const file = files[item.position - 1];
        if (!file) throw new Error("Thiếu tệp đã chọn. Hãy mở lại đợt nhập.");
        setProgress(`Đang tải sách ${item.position}/${files.length}: ${file.name}`);
        try {
          await apiRequest(`/api/book-imports/${created.id}/files/${item.id}`, {
            method: "POST",
            headers: { "content-type": "application/pdf" },
            body: file,
          });
        } catch (failure) {
          if (!(failure instanceof ApiError) || failure.status >= 500) throw failure;
        }
      }
      setProgress("Đang đưa sách vào hàng đợi…");
      await sendJson(`/api/book-imports/${created.id}`, "POST", { action: "start" });
      router.push(`/book-imports/${created.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
      setProgress("");
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-muted-foreground text-sm">
        Mỗi PDF là một sách. Sách chạy lần lượt: đọc lớp chữ / OCR → NotebookLM tìm bài học → tạo video cho tất cả bài
        học → giọng đọc → render. Drive được lưu khi đã kết nối. Có thể đóng trang sau khi tải đủ tệp.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="batch-pdf-files">Chọn tối đa 15 sách PDF (mỗi tệp tối đa {formatBytes(maxPdfBytes)})</Label>
        <Input
          id="batch-pdf-files"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          disabled={pending || batch !== null}
          onChange={(event) => choose(Array.from(event.target.files ?? []))}
        />
        {files.length > 0 ? (
          <ol className="text-muted-foreground list-inside list-decimal text-sm">
            {files.map((file, index) => (
              <li key={index} className="truncate" title={file.name}>
                {file.name} ({formatBytes(file.size)})
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <DurationRangePicker
        id="batch-duration"
        value={range}
        onChange={setRange}
        ceilingSec={ceilingSec}
        disabled={pending || batch !== null}
      />
      <PaceSelect id="batch-pace" value={pace} onChange={setPace} disabled={pending || batch !== null} />
      <p className="text-muted-foreground text-xs">
        Một video cho mỗi bài học. Sách dài có thể tạo nhiều video và tốn nhiều hạn mức. Khi provider giới hạn lượt gọi,
        hàng đợi sẽ chờ rồi tự tiếp tục.
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
        <Button
          type="button"
          disabled={files.length === 0 || pending}
          onClick={() => void submit()}
          aria-busy={pending}
        >
          {pending
            ? "Đang tải sách…"
            : batch
              ? "Tiếp tục tải và xếp hàng"
              : `Tải lên và tự động làm video${files.length ? ` cho ${files.length} sách` : ""}`}
        </Button>
        {batch ? (
          <Link href={`/book-imports/${batch.id}`} className="self-center text-sm underline">
            Xem đợt nhập
          </Link>
        ) : null}
      </div>
    </div>
  );
}
