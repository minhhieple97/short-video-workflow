"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PdfUploadPanel } from "@/features/extraction/components/pdf-upload-panel";
import { apiRequest, errorMessage } from "@/lib/api-client";

import type { ImportPreview } from "../../schemas/book.dto";

type SourceMode = "file" | "text" | "pdf";

const toSourceMode = (value: string): SourceMode => (value === "text" || value === "pdf" ? value : "file");

export function ImportSourceForm({
  onPreview,
  maxPdfBytes,
}: Readonly<{ onPreview: (preview: ImportPreview) => void; maxPdfBytes: number }>) {
  const [mode, setMode] = useState<SourceMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"md" | "txt">("txt");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = mode === "file" ? file !== null : mode === "text" && text.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Enter in the PDF tab's fields lands here too; the PDF is sent by its own button.
    if (!ready) return;
    const body = new FormData();
    if (mode === "file" && file) body.append("file", file);
    else {
      body.append("text", text);
      body.append("format", format);
    }

    setPending(true);
    setError(null);
    try {
      onPreview(await apiRequest<ImportPreview>("/api/books/import/preview", { method: "POST", body }));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex max-w-2xl flex-col gap-4">
      <Tabs value={mode} onValueChange={(value) => setMode(toSourceMode(value))}>
        <TabsList>
          <TabsTrigger value="file">Tải tệp lên</TabsTrigger>
          <TabsTrigger value="text">Dán văn bản</TabsTrigger>
          <TabsTrigger value="pdf">Sách PDF</TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="flex flex-col gap-2 pt-4">
          <Label htmlFor="book-file">Tệp sách (.md hoặc .txt, UTF-8)</Label>
          <Input
            id="book-file"
            type="file"
            accept=".md,.markdown,.txt,text/plain,text/markdown"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="text-muted-foreground text-xs">
            Tệp gốc được lưu nguyên vẹn; mọi chỉnh sửa chương chỉ tạo dữ liệu dẫn xuất.
          </p>
        </TabsContent>
        <TabsContent value="text" className="flex flex-col gap-3 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="book-format">Định dạng</Label>
            <Select value={format} onValueChange={(value) => setFormat(value === "md" ? "md" : "txt")}>
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
            onChange={(event) => setText(event.target.value)}
            placeholder="Dán toàn bộ nội dung sách vào đây…"
          />
        </TabsContent>
        {/* A PDF has no preview step: it is uploaded as is and its chapters come from the extraction. */}
        <TabsContent value="pdf" className="pt-4">
          <PdfUploadPanel maxSizeBytes={maxPdfBytes} />
        </TabsContent>
      </Tabs>

      {mode === "pdf" ? null : (
        <>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div>
            <Button type="submit" disabled={!ready || pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
              Phân tích cấu trúc chương
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
