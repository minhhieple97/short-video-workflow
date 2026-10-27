import { classifySpecialTitle, parseChapterMarker } from "./chapter-markers";
import { extractMarkdownHeadings, type MarkdownHeading } from "./markdown-headings";
import type { SourceFormat } from "./source-file";

export type SectionKind = "chapter" | "part" | "front-matter" | "table-of-contents" | "back-matter";
export type DetectionMethod = "markdown-headings" | "text-patterns" | "none";

export interface ProposedSection {
  title: string;
  start: number;
  end: number;
  kind: SectionKind;
  include: boolean;
  warnings: string[];
}

export interface BookStructure {
  method: DetectionMethod;
  headingDepth: number | null;
  suggestedTitle: string | null;
  sections: ProposedSection[];
  warnings: string[];
}

interface Boundary {
  start: number;
  title: string;
  kind: SectionKind;
}

const MIN_CHAPTER_BODY_CHARS = 120;
const MAX_SUBTITLE_LENGTH = 100;

function bodyLength(text: string, start: number, end: number): number {
  const slice = text.slice(start, end);
  const firstLineEnd = slice.indexOf("\n");
  const body = firstLineEnd === -1 ? "" : slice.slice(firstLineEnd + 1);
  return body.replace(/\s+/g, "").length;
}

function kindForTitle(title: string, fallback: SectionKind): SectionKind {
  return classifySpecialTitle(title) ?? fallback;
}

function buildSections(text: string, boundaries: Boundary[]): ProposedSection[] {
  if (boundaries.length === 0) return [];
  const sections: ProposedSection[] = [];
  const firstStart = boundaries[0]?.start ?? 0;
  const preamble = text.slice(0, firstStart);
  const hasPreamble = preamble.trim().length > 0;

  if (hasPreamble) {
    sections.push({
      title: "Phần mở đầu",
      start: 0,
      end: firstStart,
      kind: "front-matter",
      include: false,
      warnings: [],
    });
  }

  boundaries.forEach((boundary, index) => {
    const start = index === 0 && !hasPreamble ? 0 : boundary.start;
    const end = boundaries[index + 1]?.start ?? text.length;
    sections.push({
      title: boundary.title,
      start,
      end,
      kind: boundary.kind,
      include: boundary.kind === "chapter",
      warnings: [],
    });
  });
  return sections;
}

// A run of near-empty chapter sections before the first real chapter is almost always a table of contents.
function collapseLeadingTableOfContents(text: string, sections: ProposedSection[]): ProposedSection[] {
  const firstChapterIndex = sections.findIndex((section) => section.kind === "chapter");
  if (firstChapterIndex === -1) return sections;

  let runEnd = firstChapterIndex;
  while (
    runEnd < sections.length &&
    sections[runEnd]?.kind === "chapter" &&
    bodyLength(text, sections[runEnd]?.start ?? 0, sections[runEnd]?.end ?? 0) < MIN_CHAPTER_BODY_CHARS
  ) {
    runEnd += 1;
  }
  if (runEnd - firstChapterIndex < 2 || runEnd >= sections.length) return sections;

  const first = sections[firstChapterIndex];
  const last = sections[runEnd - 1];
  if (!first || !last) return sections;

  const tableOfContents: ProposedSection = {
    title: "Mục lục (tự phát hiện)",
    start: first.start,
    end: last.end,
    kind: "table-of-contents",
    include: false,
    warnings: ["Nhiều tiêu đề chương liên tiếp gần như không có nội dung — có thể là mục lục."],
  };
  return [...sections.slice(0, firstChapterIndex), tableOfContents, ...sections.slice(runEnd)];
}

function flagShortChapters(text: string, sections: ProposedSection[]): ProposedSection[] {
  return sections.map((section) =>
    section.kind === "chapter" && bodyLength(text, section.start, section.end) < MIN_CHAPTER_BODY_CHARS
      ? { ...section, warnings: [...section.warnings, "Nội dung rất ngắn — có thể là tiêu đề phụ hoặc mục lục."] }
      : section,
  );
}

function chooseHeadingDepth(headings: MarkdownHeading[]): { depth: number; titleHeading: MarkdownHeading | null } {
  const patternCounts = new Map<number, number>();
  for (const heading of headings) {
    if (parseChapterMarker(heading.text)) {
      patternCounts.set(heading.depth, (patternCounts.get(heading.depth) ?? 0) + 1);
    }
  }
  const leadingTitle =
    headings[0]?.depth === 1 && headings.filter((h) => h.depth === 1).length === 1 ? headings[0] : null;

  const bestPatternDepth = [...patternCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (bestPatternDepth) {
    return { depth: bestPatternDepth[0], titleHeading: bestPatternDepth[0] > 1 ? leadingTitle : null };
  }

  const candidates = leadingTitle && headings.some((h) => h.depth > 1) ? headings.slice(1) : headings;
  const counts = new Map<number, number>();
  for (const heading of candidates) counts.set(heading.depth, (counts.get(heading.depth) ?? 0) + 1);
  const depths = [...counts.keys()].sort((a, b) => a - b);
  const depth = depths.find((d) => (counts.get(d) ?? 0) >= 2) ?? depths[0] ?? 1;
  return { depth, titleHeading: candidates === headings ? null : leadingTitle };
}

function markdownBoundaries(headings: MarkdownHeading[]): {
  boundaries: Boundary[];
  depth: number;
  title: string | null;
} {
  const { depth, titleHeading } = chooseHeadingDepth(headings);
  const boundaries: Boundary[] = [];
  for (const heading of headings) {
    if (heading === titleHeading || heading.depth > depth) continue;
    const fallback: SectionKind = heading.depth < depth ? "part" : "chapter";
    boundaries.push({ start: heading.start, title: heading.text, kind: kindForTitle(heading.text, fallback) });
  }
  return { boundaries, depth, title: titleHeading?.text ?? null };
}

interface LineInfo {
  text: string;
  start: number;
}

function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (const line of text.split("\n")) {
    lines.push({ text: line, start });
    start += line.length + 1;
  }
  return lines;
}

function subtitleAfter(lines: LineInfo[], index: number): string | null {
  for (let i = index + 1; i < Math.min(lines.length, index + 3); i += 1) {
    const candidate = lines[i]?.text.trim() ?? "";
    if (candidate.length === 0) continue;
    if (candidate.length > MAX_SUBTITLE_LENGTH || /[.?!…]$/u.test(candidate) || parseChapterMarker(candidate))
      return null;
    return candidate;
  }
  return null;
}

function textPatternBoundaries(text: string, extraPatterns: readonly RegExp[]): Boundary[] {
  const lines = splitLines(text);
  const found: (Boundary & { level: "chapter" | "part" })[] = [];

  lines.forEach((line, index) => {
    const previous = index === 0 ? "" : (lines[index - 1]?.text ?? "");
    if (previous.trim().length > 0) return;

    const trimmed = line.text.trim();
    const marker = parseChapterMarker(trimmed);
    const extraMatch = !marker && extraPatterns.some((pattern) => pattern.test(trimmed));
    if (!marker && !extraMatch) return;

    const subtitle = marker && marker.title.length === 0 ? subtitleAfter(lines, index) : null;
    const title = subtitle ? `${trimmed}: ${subtitle}` : trimmed;
    found.push({ start: line.start, title, kind: "chapter", level: marker?.level ?? "chapter" });
  });

  const hasChapterLevel = found.some((boundary) => boundary.level === "chapter");
  return found.map(({ start, title, level }) => ({
    start,
    title,
    kind: hasChapterLevel && level === "part" ? "part" : kindForTitle(title, "chapter"),
  }));
}

export interface ParseOptions {
  extraPatterns?: readonly RegExp[];
}

export function parseBookStructure(text: string, format: SourceFormat, options: ParseOptions = {}): BookStructure {
  const warnings: string[] = [];
  let method: DetectionMethod = "none";
  let headingDepth: number | null = null;
  let suggestedTitle: string | null = null;
  let boundaries: Boundary[] = [];

  if (format === "md") {
    const headings = extractMarkdownHeadings(text);
    if (headings.length > 0) {
      const result = markdownBoundaries(headings);
      boundaries = result.boundaries;
      headingDepth = result.depth;
      suggestedTitle = result.title;
      method = "markdown-headings";
    }
  }

  if (boundaries.length === 0) {
    boundaries = textPatternBoundaries(text, options.extraPatterns ?? []);
    if (boundaries.length > 0) {
      method = "text-patterns";
      if (format === "md")
        warnings.push('Không có heading Markdown phù hợp; đã nhận diện chương theo dòng "Chương/Chapter/Phần".');
    }
  }

  let sections = buildSections(text, boundaries);
  sections = flagShortChapters(text, collapseLeadingTableOfContents(text, sections));

  const chapterCount = sections.filter((section) => section.kind === "chapter").length;
  if (sections.length === 0 || chapterCount === 0) {
    method = sections.length === 0 ? "none" : method;
    sections =
      sections.length === 0
        ? [{ title: "Toàn bộ nội dung", start: 0, end: text.length, kind: "chapter", include: true, warnings: [] }]
        : sections;
    warnings.push('Không nhận diện được ranh giới chương chắc chắn. Hãy dùng "Tách" để chia chương thủ công.');
  } else if (chapterCount === 1) {
    warnings.push("Chỉ phát hiện 1 chương. Kiểm tra lại và tách thủ công nếu cần.");
  }

  return { method, headingDepth, suggestedTitle, sections, warnings };
}
