"use client";

import { ArrowUpFromLine, BookOpen, Clapperboard, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/layout/icon-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookImportForm } from "@/features/book-imports/components/book-import-form";
import type { PdfImportSettings } from "@/features/book-imports/schemas/book-import.dto";
import { errorMessage } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { uploadFile } from "@/lib/upload-file";

function acceptedBookId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("bookId" in body)) return null;
  return typeof body.bookId === "string" ? body.bookId : null;
}

export function PdfUploadPanel({
  files,
  settings,
  initialAutomatic,
  onBusyChange,
  onLockChange,
}: Readonly<{
  files: File[];
  settings: PdfImportSettings;
  initialAutomatic: boolean;
  onBusyChange: (busy: boolean) => void;
  onLockChange: (locked: boolean) => void;
}>) {
  const router = useRouter();
  const [automatic, setAutomatic] = useState(initialAutomatic);
  const [range, setRange] = useState(settings.defaultRange);
  const [pace, setPace] = useState(settings.defaultPace);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [title, setTitle] = useState("");
  const [completed, setCompleted] = useState<Map<File, string>>(() => new Map());
  const [progress, setProgress] = useState<{ file: File; position: number; sent: number; total: number } | null>(null);
  const [error, setError] = useState<{ file: File; message: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function changeBusy(value: boolean): void {
    setBusy(value);
    onBusyChange(value);
  }
  function changeLock(value: boolean): void {
    setLocked(value);
    onLockChange(value);
  }

  async function upload(): Promise<void> {
    if (busy || files.length === 0) return;
    const controller = new AbortController();
    request.current = controller;
    const imported = new Map(completed);
    let current = files[0];
    changeBusy(true);
    setError(null);
    try {
      for (const [index, file] of files.entries()) {
        if (imported.has(file)) continue;
        current = file;
        const params = new URLSearchParams({ fileName: file.name });
        if (files.length === 1 && title.trim()) params.set("title", title.trim());
        setProgress({ file, position: index + 1, sent: 0, total: file.size });
        const body = await uploadFile(`/api/books/import/pdf?${params}`, file, controller.signal, (sent, total) =>
          setProgress({ file, position: index + 1, sent, total }),
        );
        const id = acceptedBookId(body);
        if (!id) throw new Error("Ứng dụng chưa xác nhận sách đã nhập. Hãy kiểm tra thư viện trước khi thử lại.");
        imported.set(file, id);
        setCompleted(new Map(imported));
      }
      const only = files.length === 1 && files[0] ? imported.get(files[0]) : null;
      router.push(only ? `/books/${only}` : "/books");
    } catch (failure) {
      if (current && !(failure instanceof DOMException && failure.name === "AbortError"))
        setError({ file: current, message: `${current.name}: ${errorMessage(failure)}` });
      setProgress(null);
      changeBusy(false);
    }
  }

  const percent = progress ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0;
  const importedCount = files.filter((file) => completed.has(file)).length;
  return (
    <section className="mt-5 flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-5" aria-label="Xử lý PDF">
      <fieldset disabled={busy || locked}>
        <legend className="mb-3 text-sm font-semibold">Sau khi nhập PDF</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              value: false,
              label: "Chỉ nhập sách",
              description: "Trích xuất nội dung; bạn chọn bài học và làm video sau.",
              icon: BookOpen,
            },
            {
              value: true,
              label: "Tự động làm video",
              description: "Tạo một video cho mỗi bài học của từng sách.",
              icon: Clapperboard,
            },
          ].map(({ value, label, description, icon: Icon }) => (
            <label
              key={label}
              className="has-checked:border-primary has-checked:bg-tone-violet has-focus-visible:ring-ring/50 has-disabled:opacity-50 flex cursor-pointer gap-3 rounded-lg border p-3 has-focus-visible:ring-3"
            >
              <input
                type="radio"
                name="pdf-processing"
                value={value ? "automatic" : "library"}
                checked={automatic === value}
                onChange={() => setAutomatic(value)}
                className="accent-primary mt-1 size-4 shrink-0"
              />
              <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-muted-foreground text-xs">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div hidden={!automatic}>
        <BookImportForm
          key={files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|")}
          files={files}
          settings={settings}
          onBusyChange={changeBusy}
          onLockChange={changeLock}
          range={range}
          pace={pace}
          onRangeChange={setRange}
          onPaceChange={setPace}
        />
      </div>
      <form
        hidden={automatic}
        onSubmit={(event) => {
          event.preventDefault();
          void upload();
        }}
      >
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Mỗi PDF là một sách. Nội dung được nhận diện và chia chương trong nền; bản gốc được giữ nguyên.
          </p>
          {files.length === 1 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="pdf-title">Tên sách (không bắt buộc)</Label>
              <Input
                id="pdf-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                disabled={busy}
                placeholder="Mặc định lấy từ tên tệp"
              />
            </div>
          ) : null}
          {progress ? (
            <div className="flex flex-col gap-2" role="status">
              <p className="truncate text-sm" title={progress.file.name}>
                Đang tải sách {progress.position}/{files.length}: {progress.file.name}
              </p>
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
              <p className="text-muted-foreground text-xs">
                {progress.sent >= progress.total
                  ? "Đang lưu và kiểm tra tệp…"
                  : `${formatBytes(progress.sent)} / ${formatBytes(progress.total)}`}
              </p>
            </div>
          ) : null}
          {importedCount > 0 ? (
            <p className="text-muted-foreground text-sm">
              Đã nhập {importedCount}/{files.length} sách. Các sách đã nhập sẽ được giữ lại nếu bạn dừng tải.
            </p>
          ) : null}
          {error && files.includes(error.file) ? (
            <Alert variant="destructive">
              <AlertDescription className="wrap-break-word">{error.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center gap-3">
            <IconButton
              type="submit"
              label={`Nhập ${files.length} sách PDF`}
              disabled={busy || files.length === 0}
              aria-busy={busy}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUpFromLine aria-hidden />}
            </IconButton>
            <p className="text-muted-foreground text-sm">
              {busy ? "Giữ trang mở đến khi tải xong." : `Nhập ${files.length} sách vào thư viện`}
            </p>
            {busy ? (
              <IconButton type="button" label="Dừng tải tệp" variant="outline" onClick={() => request.current?.abort()}>
                <X aria-hidden />
              </IconButton>
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}
