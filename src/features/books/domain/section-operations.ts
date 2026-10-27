import type { SectionKind } from "./book-structure";

export interface DraftSection {
  id: string;
  title: string;
  start: number;
  end: number;
  kind: SectionKind;
  include: boolean;
  warnings: string[];
}

const MAX_TITLE_LENGTH = 120;

function indexOfSection(sections: readonly DraftSection[], id: string): number {
  const index = sections.findIndex((section) => section.id === id);
  if (index === -1) throw new Error(`Unknown section ${id}`);
  return index;
}

export function renameSection(sections: readonly DraftSection[], id: string, title: string): DraftSection[] {
  return sections.map((section) => (section.id === id ? { ...section, title } : section));
}

export function toggleSectionIncluded(sections: readonly DraftSection[], id: string): DraftSection[] {
  return sections.map((section) => (section.id === id ? { ...section, include: !section.include } : section));
}

export function moveSection(sections: readonly DraftSection[], id: string, direction: -1 | 1): DraftSection[] {
  const index = indexOfSection(sections, id);
  const target = index + direction;
  if (target < 0 || target >= sections.length) return [...sections];
  const next = [...sections];
  const [moved] = next.splice(index, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}

// Merging is only allowed with the next section when both are contiguous in the source text.
export function canMergeWithNext(sections: readonly DraftSection[], id: string): boolean {
  const index = indexOfSection(sections, id);
  const current = sections[index];
  const following = sections[index + 1];
  return Boolean(current && following && current.end === following.start);
}

export function mergeWithNext(sections: readonly DraftSection[], id: string): DraftSection[] {
  if (!canMergeWithNext(sections, id)) return [...sections];
  const index = indexOfSection(sections, id);
  const current = sections[index];
  const following = sections[index + 1];
  if (!current || !following) return [...sections];

  const merged: DraftSection = {
    ...current,
    end: following.end,
    include: current.include || following.include,
    kind: current.kind === "chapter" || following.kind === "chapter" ? "chapter" : current.kind,
    warnings: [],
  };
  return [...sections.slice(0, index), merged, ...sections.slice(index + 2)];
}

export function splitSection(
  sections: readonly DraftSection[],
  id: string,
  at: number,
  newSection: Pick<DraftSection, "id" | "title">,
): DraftSection[] {
  const index = indexOfSection(sections, id);
  const current = sections[index];
  if (!current || at <= current.start || at >= current.end) return [...sections];

  const head: DraftSection = { ...current, end: at, warnings: [] };
  const tail: DraftSection = {
    ...current,
    id: newSection.id,
    title: newSection.title,
    start: at,
    kind: "chapter",
    include: true,
    warnings: [],
  };
  return [...sections.slice(0, index), head, tail, ...sections.slice(index + 1)];
}

export interface ParagraphStart {
  offset: number;
  preview: string;
}

export function findParagraphStarts(text: string, start: number, end: number): ParagraphStart[] {
  const starts: ParagraphStart[] = [];
  const pattern = /\n[ \t]*\n+/g;
  pattern.lastIndex = start;
  for (let match = pattern.exec(text); match && match.index < end; match = pattern.exec(text)) {
    const offset = match.index + match[0].length;
    if (offset >= end) break;
    const lineEnd = text.indexOf("\n", offset);
    const line = text.slice(offset, lineEnd === -1 || lineEnd > end ? end : lineEnd).trim();
    if (line.length > 0) starts.push({ offset, preview: line.slice(0, MAX_TITLE_LENGTH) });
  }
  return starts;
}

export function suggestTitleAt(text: string, offset: number): string {
  const lineEnd = text.indexOf("\n", offset);
  const line = text
    .slice(offset, lineEnd === -1 ? undefined : lineEnd)
    .replace(/^#+\s*/, "")
    .trim();
  return line.slice(0, MAX_TITLE_LENGTH) || "Chương mới";
}

export function sectionExcerpt(text: string, section: Pick<DraftSection, "start" | "end">, maxLength = 240): string {
  const slice = text.slice(section.start, section.end);
  const firstLineEnd = slice.indexOf("\n");
  const body = (firstLineEnd === -1 ? slice : slice.slice(firstLineEnd + 1)).replace(/\s+/g, " ").trim();
  return body.length > maxLength ? `${body.slice(0, maxLength)}…` : body;
}
