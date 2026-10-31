import { createHash } from "node:crypto";

import { findChapterWithBook } from "@/features/chapters/repositories/chapter.repository";
import { loadChapterSource } from "@/features/extraction/services/chapter-source.service";
import { locateExcerpt } from "@/features/lessons/domain/source-excerpts";
import { AppError } from "@/shared/errors";

import type { LessonSnapshot } from "../domain/lesson-snapshot";
import {
  SOURCE_CONTEXT_CHARS,
  SOURCE_PACK_MAX_CHARS,
  scriptSourcePackSchema,
  type ScriptSourcePack,
} from "../domain/script-source-pack";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export async function buildScriptSourcePack(
  bookId: string,
  lessons: readonly LessonSnapshot[],
): Promise<ScriptSourcePack> {
  const anchors: { lessonId: string; chapterId: string; excerpt: string }[] = [];
  for (const lesson of lessons) {
    const sources = lesson.sources.filter((source) => source.excerpt?.trim());
    if (!sources.length)
      throw new AppError("SCRIPT_SOURCE_MISSING", `Bài học “${lesson.title}” chưa có trích đoạn nguồn.`, 409);
    for (const source of sources)
      anchors.push({ lessonId: lesson.lessonId, chapterId: source.chapterId, excerpt: source.excerpt ?? "" });
  }
  const chapters = new Map<string, Awaited<ReturnType<typeof loadChapterSource>> & { title: string }>();
  for (const id of new Set(anchors.map((anchor) => anchor.chapterId))) {
    const chapter = await findChapterWithBook(id);
    if (!chapter || chapter.bookId !== bookId)
      throw new AppError("SCRIPT_SOURCE_BOOK_MISMATCH", "Chương nguồn không thuộc sách của video.", 409);
    const source = await loadChapterSource(chapter, chapter.book.sourceFormat);
    const text = source.text.normalize("NFC");
    const offsets: number[] = [];
    if (text !== source.text) {
      for (const segment of new Intl.Segmenter("vi", { granularity: "grapheme" }).segment(source.text)) {
        for (let offset = 0; offset < segment.segment.normalize("NFC").length; offset += 1)
          offsets.push(segment.index + offset);
      }
    }
    chapters.set(id, {
      ...source,
      text,
      title: chapter.title,
      pageAt: (offset) => source.pageAt(offsets[offset] ?? offset),
    });
  }
  const located = anchors.map((anchor) => {
    const chapter = chapters.get(anchor.chapterId);
    const excerpt = anchor.excerpt.normalize("NFC");
    const start = chapter ? locateExcerpt(chapter.text, excerpt) : null;
    if (!chapter || start === null)
      throw new AppError(
        "SCRIPT_SOURCE_EXCERPT_MISMATCH",
        "Trích đoạn bài học không còn khớp chương nguồn. Hãy kiểm tra lại nguồn bài học.",
        409,
      );
    const pattern = excerpt
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const matched = new RegExp(pattern, "u").exec(chapter.text.slice(start))?.[0];
    if (!matched)
      throw new AppError("SCRIPT_SOURCE_EXCERPT_MISMATCH", "Không xác định được vị trí trích đoạn nguồn.", 409);
    return { ...anchor, start, end: start + matched.length, excerpt: matched };
  });
  const makeSources = (contextChars: number): ScriptSourcePack["sources"] => {
    const groups: { chapterId: string; start: number; end: number; anchors: typeof located }[] = [];
    for (const anchor of [...located].sort((a, b) => a.chapterId.localeCompare(b.chapterId) || a.start - b.start)) {
      const chapter = chapters.get(anchor.chapterId);
      if (!chapter) continue;
      const start = Math.max(0, anchor.start - contextChars);
      const end = Math.min(chapter.text.length, anchor.end + contextChars);
      const previous = groups.at(-1);
      if (previous && previous.chapterId === anchor.chapterId && start <= previous.end) {
        previous.end = Math.max(previous.end, end);
        previous.anchors.push(anchor);
      } else groups.push({ chapterId: anchor.chapterId, start, end, anchors: [anchor] });
    }
    return groups.map((group) => {
      const chapter = chapters.get(group.chapterId);
      if (!chapter) throw new AppError("SCRIPT_SOURCE_MISSING", "Không đọc được chương nguồn.", 409);
      const pages: { page: number | null; start: number; end: number }[] = [];
      let cursor = group.start;
      while (cursor < group.end) {
        const page = chapter.pageAt(cursor);
        let low = cursor + 1;
        let high = group.end;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (chapter.pageAt(middle) === page) low = middle + 1;
          else high = middle;
        }
        pages.push({ page, start: cursor - group.start, end: low - group.start });
        cursor = low;
      }
      return {
        id: `source-${sha(`${group.chapterId}:${group.start}:${group.end}:${chapter.text}`).slice(0, 20)}`,
        lessonIds: [...new Set(group.anchors.map((anchor) => anchor.lessonId))],
        chapterId: group.chapterId,
        chapterTitle: chapter.title,
        chapterHash: sha(chapter.text),
        start: group.start,
        end: group.end,
        page: chapter.pageAt(group.start),
        endPage: chapter.pageAt(group.end - 1),
        pages,
        text: chapter.text.slice(group.start, group.end),
        excerpt: group.anchors.map((anchor) => anchor.excerpt).join("\n"),
      };
    });
  };
  let context = SOURCE_CONTEXT_CHARS;
  let sources = makeSources(context);
  while (sources.reduce((total, source) => total + source.text.length, 0) > SOURCE_PACK_MAX_CHARS && context > 0) {
    context = Math.floor(context / 2);
    sources = makeSources(context);
  }
  if (sources.reduce((total, source) => total + source.text.length, 0) > SOURCE_PACK_MAX_CHARS)
    throw new AppError(
      "SCRIPT_SOURCE_TOO_LARGE",
      "Các trích đoạn nguồn vượt giới hạn. Hãy tách video thành ít bài học hơn.",
      409,
    );
  return scriptSourcePackSchema.parse({ version: "script-source-pack-v1", bookId, sources });
}
