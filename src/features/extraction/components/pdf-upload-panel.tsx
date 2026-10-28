"use client";

import { FileUp, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/format";

interface UploadProgress {
  sent: number;
  total: number;
}

interface ImportAccepted {
  bookId: string;
}

interface ErrorBody {
  error?: { message?: string };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function acceptedBookId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("bookId" in body)) return null;
  const { bookId } = body as ImportAccepted;
  return typeof bookId === "string" ? bookId : null;
}

// Sends the PDF as the raw request body, so the browser streams it from disk. XMLHttpRequest rather than fetch because
// only it reports upload progress: the bar shows the bytes actually sent, never an estimate.
export function PdfUploadPanel({ maxSizeBytes }: Readonly<{ maxSizeBytes: number }>) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  function chooseFile(next: File | null): void {
    setError(null);
    if (next && next.size > maxSizeBytes) {
      setFile(null);
      setError(`Tệp PDF ${formatBytes(next.size)} vượt quá giới hạn ${formatBytes(maxSizeBytes)}.`);
      return;
    }
    setFile(next);
  }

  function upload(): void {
    if (!file) return;
    const params = new URLSearchParams({ fileName: file.name });
    if (title.trim()) params.set("title", title.trim());
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", `/api/books/import/pdf?${params.toString()}`);
    xhr.setRequestHeader("content-type", "application/pdf");
    xhr.upload.onprogress = (event) => setProgress({ sent: event.loaded, total: event.total || file.size });
    xhr.onload = () => {
      request.current = null;
      const body = parseJson(xhr.responseText);
      const bookId = xhr.status === 202 ? acceptedBookId(body) : null;
      if (bookId) {
        router.push(`/books/${bookId}`);
        return;
      }
      setProgress(null);
      setError((body as ErrorBody | null)?.error?.message ?? `Tải lên thất bại (HTTP ${xhr.status}).`);
    };
    xhr.onerror = () => {
      request.current = null;
      setProgress(null);
      setError("Không gửi được tệp tới ứng dụng. Kiểm tra máy chủ đang chạy rồi thử lại.");
    };
    xhr.onabort = () => {
      request.current = null;
      setProgress(null);
    };
    setError(null);
    setProgress({ sent: 0, total: file.size });
    xhr.send(file);
  }

  const uploading = progress !== null;
  const percent = progress && progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="pdf-file">Tệp PDF (tối đa {formatBytes(maxSizeBytes)})</Label>
        <Input
          id="pdf-file"
          type="file"
          accept=".pdf,application/pdf"
          disabled={uploading}
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
        <p className="text-muted-foreground text-xs">
          Trang có lớp chữ được đọc trực tiếp, miễn phí. Chỉ trang scan hoặc dùng font tiếng Việt cũ mới được gửi OCR
          (Mistral, cần <code className="bg-muted rounded px-1">MISTRAL_API_KEY</code>), trong trần chi phí bạn đặt cho
          từng sách. Chương được tạo khi trích xuất xong.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pdf-title">Tên sách (không bắt buộc)</Label>
        <Input
          id="pdf-title"
          value={title}
          maxLength={200}
          disabled={uploading}
          placeholder="Mặc định lấy từ tên tệp"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      {uploading ? (
        <div className="flex flex-col gap-1">
          <div
            className="bg-muted h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Đã gửi tệp PDF"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="bg-primary h-full transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            {progress.sent >= progress.total
              ? "Đã gửi xong, đang lưu và kiểm tra tệp…"
              : `Đã gửi ${formatBytes(progress.sent)} / ${formatBytes(progress.total)}`}
          </p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={upload} disabled={!file || uploading}>
          {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
          Tải lên và trích xuất
        </Button>
        {uploading ? (
          <Button type="button" variant="outline" onClick={() => request.current?.abort()}>
            <X aria-hidden />
            Huỷ tải lên
          </Button>
        ) : null}
      </div>
    </div>
  );
}
