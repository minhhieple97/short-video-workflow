"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/layout/icon-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { PdfImportSettings } from "@/features/book-imports/schemas/book-import.dto";
import { PdfUploadPanel } from "@/features/extraction/components/pdf-upload-panel";
import { apiRequest, errorMessage } from "@/lib/api-client";

import type { ImportPreview } from "../../schemas/book.dto";
import { ImportFilePicker } from "./import-file-picker";

export function ImportSourceForm({
  onPreview,
  settings,
  maxTextBytes,
  initialAutomatic,
}: Readonly<{
  onPreview: (preview: ImportPreview) => void;
  settings: PdfImportSettings;
  maxTextBytes: number;
  initialAutomatic: boolean;
}>) {
  const [mode, setMode] = useState("file");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"md" | "txt">("txt");
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdf = files.length > 0 && files.every((file) => /\.pdf$/i.test(file.name));
  const ready = mode === "text" ? text.trim().length > 0 : files.length === 1 && !pdf;

  async function preview(): Promise<void> {
    if (!ready || pending) return;
    const body = new FormData();
    const file = files[0];
    if (mode === "file" && file) body.append("file", file);
    else {
      body.append("text", text);
      body.append("format", format);
    }
    setPending(true);
    setError(null);
    try {
      onPreview(await apiRequest<ImportPreview>("/api/books/import/preview", { method: "POST", body }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value);
          setError(null);
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="file" disabled={pending || locked}>
            Tải tệp lên
          </TabsTrigger>
          <TabsTrigger value="text" disabled={pending || locked}>
            Dán văn bản
          </TabsTrigger>
        </TabsList>
        <TabsContent value="file" forceMount className="data-[state=inactive]:hidden">
          <ImportFilePicker
            files={files}
            onChange={(next) => {
              setFiles(next);
              setError(null);
            }}
            maxPdfBytes={settings.maxPdfBytes}
            maxTextBytes={maxTextBytes}
            disabled={pending || locked}
          />
          {pdf ? (
            <PdfUploadPanel
              files={files}
              settings={settings}
              initialAutomatic={initialAutomatic}
              onBusyChange={setPending}
              onLockChange={setLocked}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="text" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="book-format">Định dạng</Label>
            <Select
              value={format}
              onValueChange={(value) => setFormat(value === "md" ? "md" : "txt")}
              disabled={pending}
            >
              <SelectTrigger id="book-format" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="txt">Văn bản thuần (.txt)</SelectItem>
                <SelectItem value="md">Markdown (.md)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Label htmlFor="book-text">Nội dung sách</Label>
          <Textarea
            id="book-text"
            rows={12}
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
            placeholder="Dán nội dung sách vào đây…"
          />
        </TabsContent>
      </Tabs>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {mode === "text" || (files.length > 0 && !pdf) ? (
        <div className="flex items-center gap-3">
          <IconButton
            type="button"
            label="Phân tích cấu trúc chương"
            disabled={!ready || pending}
            aria-busy={pending}
            onClick={() => void preview()}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
          </IconButton>
          <p className="text-muted-foreground text-sm" role="status">
            {pending ? "Đang đọc cấu trúc sách…" : "Xem và kiểm tra danh sách chương trước khi nhập."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
