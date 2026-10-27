"use client";

import { ArrowDown, ArrowUp, Combine, Eye, Scissors } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

import { sectionExcerpt, type DraftSection } from "../../domain/section-operations";
import { SECTION_KIND_LABELS } from "./section-labels";

interface SectionRowProps {
  section: DraftSection;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  canMerge: boolean;
  text: string;
  onRename: (title: string) => void;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
  onMerge: () => void;
  onSplit: () => void;
  onView: () => void;
}

export function SectionRow(props: Readonly<SectionRowProps>) {
  const { section, position, isFirst, isLast, canMerge, text } = props;
  const titleMissing = section.include && section.title.trim().length === 0;

  return (
    <li className={cn("border-border flex flex-col gap-2 rounded-lg border p-3", !section.include && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          checked={section.include}
          onCheckedChange={props.onToggle}
          aria-label={section.include ? "Bỏ khỏi danh sách chương" : "Nhập như một chương"}
        />
        <span className="text-muted-foreground w-6 text-sm tabular-nums">{position}</span>
        <Input
          value={section.title}
          onChange={(event) => props.onRename(event.target.value)}
          aria-label={`Tên mục ${position}`}
          aria-invalid={titleMissing}
          maxLength={200}
          className="min-w-48 flex-1"
        />
        <Badge variant={section.kind === "chapter" ? "violet" : "slate"}>{SECTION_KIND_LABELS[section.kind]}</Badge>
      </div>

      <p className="text-muted-foreground line-clamp-2 text-xs">{sectionExcerpt(text, section) || "(trống)"}</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground mr-auto text-xs">
          Bắt đầu tại ký tự {formatNumber(section.start)} · {formatNumber(section.end - section.start)} ký tự
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={props.onView}>
          <Eye aria-hidden /> Xem
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={props.onSplit}>
          <Scissors aria-hidden /> Tách
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={props.onMerge} disabled={!canMerge}>
          <Combine aria-hidden /> Gộp với mục sau
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => props.onMove(-1)}
          disabled={isFirst}
          aria-label="Chuyển lên"
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => props.onMove(1)}
          disabled={isLast}
          aria-label="Chuyển xuống"
        >
          <ArrowDown aria-hidden />
        </Button>
      </div>

      {section.warnings.length > 0 ? (
        <ul className="text-xs text-amber-700 dark:text-amber-400">
          {section.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
