"use client";

import { ArrowLeft, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/layout/icon-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, sendJson } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";

import {
  canMergeWithNext,
  mergeWithNext,
  moveSection,
  renameSection,
  splitSection,
  suggestTitleAt,
  toggleSectionIncluded,
  type DraftSection,
} from "../../domain/section-operations";
import type { ImportPreview } from "../../schemas/book.dto";
import { SectionContentDialog, SplitSectionDialog } from "./section-dialogs";
import { SectionRow } from "./section-row";

const METHOD_LABELS: Record<ImportPreview["method"], string> = {
  "markdown-headings": "theo heading Markdown",
  "text-patterns": "theo dòng “Chương/Chapter/Phần”",
  none: "không nhận diện được — cần chia thủ công",
};

export function ImportReview({ preview, onBack }: Readonly<{ preview: ImportPreview; onBack: () => void }>) {
  const router = useRouter();
  const nextId = useRef(preview.sections.length);
  const [sections, setSections] = useState<DraftSection[]>(() =>
    preview.sections.map((section, index) => ({ ...section, id: `section-${index}` })),
  );
  const [title, setTitle] = useState(preview.suggestedTitle);
  const [author, setAuthor] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [splitTarget, setSplitTarget] = useState<DraftSection | null>(null);
  const [viewTarget, setViewTarget] = useState<DraftSection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const included = sections.filter((section) => section.include);
  const blockers = [
    title.trim().length === 0 && "Hãy nhập tên sách.",
    included.length === 0 && "Hãy chọn ít nhất một chương.",
    included.some((section) => section.title.trim().length === 0) && "Mỗi chương cần có tên.",
    preview.duplicateOf && !allowDuplicate && "Tệp này đã được nhập. Mở sách có sẵn hoặc xác nhận tạo bản mới.",
  ].filter((message): message is string => typeof message === "string");

  function handleSplit(offset: number): void {
    if (!splitTarget) return;
    nextId.current += 1;
    const newSection = { id: `section-${nextId.current}`, title: suggestTitleAt(preview.text, offset) };
    setSections((current) => splitSection(current, splitTarget.id, offset, newSection));
    setSplitTarget(null);
  }

  async function handleConfirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const { bookId } = await sendJson<{ bookId: string }>("/api/books/import/confirm", "POST", {
        importId: preview.importId,
        title,
        author,
        allowDuplicate,
        chapters: included.map((section) => ({ title: section.title.trim(), start: section.start, end: section.end })),
      });
      toast.success(`Đã nhập "${title}" với ${included.length} chương.`);
      router.push(`/books/${bookId}`);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-title">Tên sách</Label>
          <Input id="import-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-author">Tác giả</Label>
          <Input
            id="import-author"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={200}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        {preview.fileName} · {formatBytes(preview.sizeBytes)} · Nhận diện {METHOD_LABELS[preview.method]}
      </p>

      {preview.duplicateOf ? (
        <Alert>
          <AlertTitle>Tệp này đã được nhập trước đó</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Trùng nội dung với sách{" "}
              <Link href={`/books/${preview.duplicateOf.id}`} className="font-medium underline">
                {preview.duplicateOf.title}
              </Link>
              . Mặc định không tạo bản trùng.
            </span>
            <label className="flex items-center gap-2">
              <Checkbox checked={allowDuplicate} onCheckedChange={(value) => setAllowDuplicate(value === true)} />
              Vẫn tạo một sách mới từ tệp này
            </label>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>Cần kiểm tra</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">
          Danh sách chương ({included.length} được nhập / {sections.length} mục)
        </h2>
        <p className="text-muted-foreground text-sm">
          Bỏ chọn mục lục, lời nói đầu… Đổi tên, tách, gộp hoặc sắp xếp lại trước khi xác nhận.
        </p>
        <ol className="flex flex-col gap-2">
          {sections.map((section, index) => (
            <SectionRow
              key={section.id}
              section={section}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              canMerge={canMergeWithNext(sections, section.id)}
              text={preview.text}
              onRename={(value) => setSections((current) => renameSection(current, section.id, value))}
              onToggle={() => setSections((current) => toggleSectionIncluded(current, section.id))}
              onMove={(direction) => setSections((current) => moveSection(current, section.id, direction))}
              onMerge={() => setSections((current) => mergeWithNext(current, section.id))}
              onSplit={() => setSplitTarget(section)}
              onView={() => setViewTarget(section)}
            />
          ))}
        </ol>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {blockers.length > 0 ? <p className="text-muted-foreground text-sm">{blockers[0]}</p> : null}

      <div className="flex flex-wrap gap-2">
        <IconButton type="button" label="Chọn tệp khác" variant="outline" onClick={onBack} disabled={pending}>
          <ArrowLeft aria-hidden />
        </IconButton>
        <IconButton
          type="button"
          label={`Xác nhận nhập ${included.length} chương`}
          aria-busy={pending}
          onClick={() => void handleConfirm()}
          disabled={blockers.length > 0 || pending}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
        </IconButton>
        <p className="text-muted-foreground self-center text-sm" role="status">
          {pending ? "Đang lưu sách…" : `Nhập sách với ${included.length} chương đã chọn`}
        </p>
      </div>

      <SplitSectionDialog
        section={splitTarget}
        text={preview.text}
        onClose={() => setSplitTarget(null)}
        onSplit={handleSplit}
      />
      <SectionContentDialog section={viewTarget} text={preview.text} onClose={() => setViewTarget(null)} />
    </div>
  );
}
