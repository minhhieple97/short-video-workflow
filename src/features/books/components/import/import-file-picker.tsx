"use client";

import { FileText, FolderOpen, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { IconButton } from "@/components/layout/icon-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MAX_BOOKS_PER_IMPORT } from "@/features/book-imports/schemas/book-import.schema";
import { formatBytes } from "@/lib/format";

import { importSelectionError } from "../../domain/import-selection";

export function ImportFilePicker({
  files,
  onChange,
  maxPdfBytes,
  maxTextBytes,
  disabled,
}: Readonly<{
  files: File[];
  onChange: (files: File[]) => void;
  maxPdfBytes: number;
  maxTextBytes: number;
  disabled: boolean;
}>) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(next: File[]): void {
    const problem = importSelectionError(next, { maxPdfBytes, maxTextBytes, maxPdfFiles: MAX_BOOKS_PER_IMPORT });
    setError(problem);
    onChange(problem ? [] : next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card flex items-center gap-4 rounded-xl border border-dashed p-5">
        <div className="bg-tone-violet text-primary hidden size-12 shrink-0 items-center justify-center rounded-xl sm:flex">
          <FileText className="size-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{files.length ? `${files.length} tệp đã chọn` : "Chọn tệp sách"}</p>
          <p className="text-muted-foreground text-sm">1–15 PDF, hoặc một tệp TXT / Markdown.</p>
          <p className="text-muted-foreground mt-1 text-xs">
            PDF tối đa {formatBytes(maxPdfBytes)}/tệp · TXT / Markdown tối đa {formatBytes(maxTextBytes)}.
          </p>
        </div>
        <IconButton
          type="button"
          label={files.length ? "Thay đổi tệp" : "Chọn tệp sách"}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {files.length ? <FolderOpen aria-hidden /> : <Upload aria-hidden />}
        </IconButton>
        <input
          ref={input}
          id="book-file"
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Tệp sách"
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/plain,text/markdown"
          disabled={disabled}
          onChange={(event) => {
            choose(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {files.length ? (
        <ul className="divide-border bg-card divide-y overflow-hidden rounded-xl border" aria-label="Tệp đã chọn">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-3 px-4 py-3">
              <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                {file.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatBytes(file.size)}</span>
              <IconButton
                type="button"
                label={`Bỏ tệp ${file.name}`}
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={() => {
                  setError(null);
                  onChange(files.filter((_, position) => position !== index));
                }}
              >
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
