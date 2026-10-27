"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { findParagraphStarts, type DraftSection } from "../../domain/section-operations";

interface SectionDialogProps {
  section: DraftSection | null;
  text: string;
  onClose: () => void;
}

export function SectionContentDialog({ section, text, onClose }: Readonly<SectionDialogProps>) {
  return (
    <Dialog open={section !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{section?.title || "Nội dung"}</DialogTitle>
          <DialogDescription>Nội dung đoạn này trong tệp gốc.</DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-y-auto font-sans text-sm whitespace-pre-wrap">
          {section ? text.slice(section.start, section.end) : ""}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

export function SplitSectionDialog({
  section,
  text,
  onClose,
  onSplit,
}: Readonly<SectionDialogProps & { onSplit: (offset: number) => void }>) {
  const paragraphs = useMemo(
    () => (section ? findParagraphStarts(text, section.start, section.end) : []),
    [section, text],
  );

  return (
    <Dialog open={section !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tách “{section?.title}”</DialogTitle>
          <DialogDescription>Chọn đoạn sẽ trở thành điểm bắt đầu của chương mới.</DialogDescription>
        </DialogHeader>
        {paragraphs.length === 0 ? (
          <p className="text-muted-foreground text-sm">Mục này chỉ có một đoạn nên không thể tách.</p>
        ) : (
          <ol className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {paragraphs.map((paragraph) => (
              <li key={paragraph.offset} className="flex items-center gap-2 rounded-md p-1 hover:bg-muted">
                <span className="line-clamp-2 flex-1 text-sm">{paragraph.preview}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => onSplit(paragraph.offset)}>
                  Tách tại đây
                </Button>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
