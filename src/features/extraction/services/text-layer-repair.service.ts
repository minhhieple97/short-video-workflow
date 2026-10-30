import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeChapterContent } from "@/features/books/domain/chapter-content";
import { readDataFile, writeChapterFile } from "@/features/books/services/book-files";
import { analysisHashChanges, type AnalysisInput } from "@/features/chapters/services/analysis-hash-changes";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { AppError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { assembleCanonicalMarkdown } from "../domain/canonical-document";
import { repairMisencodedDStroke, repairTextLayer } from "../domain/text-layer-repair";
import { findCompletedExtractionForBook } from "../repositories/extraction.repository";
import {
  copyDatabaseTo,
  findCompletedAiRuns,
  listChaptersForRepair,
  listExtractionPagesWithMethod,
  listLessonSourceExcerpts,
  writeTextLayerRepair,
  type TextLayerRepairWrites,
} from "../repositories/text-layer-repair.repository";

const logger = createLogger("extraction.repair");

const ANALYSIS_IN_FLIGHT = new Set(["QUEUED", "ANALYZING", "WAITING_FOR_CLI"]);

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export interface ChapterRepair {
  id: string;
  order: number;
  contentPath: string;
  title: string;
  content: string;
  contentHash: string;
}

export interface TextLayerRepairPlan {
  bookId: string;
  extractionId: string;
  canonicalPath: string;
  markdown: string;
  repairedCharacters: number;
  pages: TextLayerRepairWrites["pages"];
  chapters: ChapterRepair[];
  renamedChapters: number;
  skippedChapters: { order: number; reason: string }[];
  excerpts: TextLayerRepairWrites["excerpts"];
  analyses: TextLayerRepairWrites["analyses"];
}

export type TextLayerRepairOutcome =
  | { kind: "NOT_NEEDED"; reason: string }
  | { kind: "BLOCKED"; reason: string }
  | { kind: "READY"; plan: TextLayerRepairPlan };

// What repairing a PDF book that was imported with đ/Đ misread (see domain/text-layer-repair.ts) would change: the stored
// pages, the canonical document, every chapter (title, file, hash) and the source excerpts of its lessons. Nothing is
// written. The repair keeps every length, so the chapters' offsets and the excerpts' locators stay valid.
export async function planTextLayerRepair(book: { id: string; title: string }): Promise<TextLayerRepairOutcome> {
  const extraction = await findCompletedExtractionForBook(book.id);
  if (!extraction?.canonicalPath || extraction.pageCount === null) {
    return { kind: "NOT_NEEDED", reason: "Sách chưa có bản trích xuất hoàn tất." };
  }

  const stored = await listExtractionPagesWithMethod(extraction.id);
  const layerPages = stored.filter((page) => page.method === "TEXT" && page.text !== null);
  const layer = repairTextLayer(layerPages.map((page) => page.text ?? ""));
  if (layer.repairedCharacters === 0) {
    return { kind: "NOT_NEEDED", reason: "Lớp chữ không có chữ đ/Đ bị đọc sai." };
  }

  const chapters = await listChaptersForRepair(book.id);
  const busy = chapters.filter((chapter) => ANALYSIS_IN_FLIGHT.has(chapter.analysisStatus));
  if (busy.length > 0) {
    const orders = busy.map((chapter) => chapter.order).join(", ");
    return { kind: "BLOCKED", reason: `Chương ${orders} đang được phân tích; chờ xong rồi chạy lại.` };
  }

  const repairedByPage = new Map(layerPages.map((page, index) => [page.pageNumber, layer.texts[index] ?? ""]));
  const before = stored.map((page) => ({ pageNumber: page.pageNumber, text: page.text ?? "" }));
  const after = before.map((page) => ({ ...page, text: repairedByPage.get(page.pageNumber) ?? page.text }));
  const oldMarkdown = assembleCanonicalMarkdown(before, extraction.pageCount).markdown;
  const markdown = assembleCanonicalMarkdown(after, extraction.pageCount).markdown;
  if (markdown.length !== oldMarkdown.length) {
    throw new AppError("TEXT_REPAIR_CHANGED_LENGTH", "Bản sửa làm đổi độ dài văn bản nên bị huỷ.", 500);
  }
  if ((await readDataFile(extraction.canonicalPath)) !== oldMarkdown) {
    return { kind: "BLOCKED", reason: "File văn bản đã trích xuất không khớp các trang đã lưu nên không sửa tự động." };
  }

  const repairs: ChapterRepair[] = [];
  const finishedAnalyses: { before: AnalysisInput; after: AnalysisInput }[] = [];
  const skippedChapters: TextLayerRepairPlan["skippedChapters"] = [];
  let renamedChapters = 0;
  for (const chapter of chapters) {
    const { sourceStartOffset: start, sourceEndOffset: end, contentPath } = chapter;
    if (start === null || end === null || contentPath === null) {
      skippedChapters.push({ order: chapter.order, reason: "Chương không gắn với vị trí trong văn bản trích xuất." });
      continue;
    }
    if (sha256(normalizeChapterContent(oldMarkdown.slice(start, end))) !== chapter.contentHash) {
      skippedChapters.push({ order: chapter.order, reason: "Nội dung chương không còn khớp bản trích xuất." });
      continue;
    }
    const content = normalizeChapterContent(markdown.slice(start, end));
    const title = repairMisencodedDStroke(chapter.title);
    const contentHash = sha256(content);
    if (contentHash === chapter.contentHash && title === chapter.title) continue;
    repairs.push({ id: chapter.id, order: chapter.order, contentPath, title, content, contentHash });
    if (title !== chapter.title) renamedChapters += 1;
    if (chapter.analysisStatus === "ANALYZED") {
      finishedAnalyses.push({
        before: { contentHash: chapter.contentHash, title: chapter.title },
        after: { contentHash, title },
      });
    }
  }

  const excerpts = (await listLessonSourceExcerpts(book.id)).flatMap(({ id, sourceExcerpt }) => {
    const repaired = repairMisencodedDStroke(sourceExcerpt ?? "");
    return repaired === sourceExcerpt ? [] : [{ id, sourceExcerpt: repaired }];
  });

  const changes = finishedAnalyses.flatMap(({ before, after }) => analysisHashChanges(before, after, book.title));
  const finished = changes.length > 0 ? await findCompletedAiRuns(changes.map((change) => change.from)) : [];
  const nextHash = new Map(changes.map((change) => [change.from, change.to]));
  const analyses = finished.flatMap((run) => {
    const inputHash = nextHash.get(run.inputHash);
    return inputHash
      ? [{ inputHash, mode: run.mode, promptVersion: run.promptVersion, completedAt: run.completedAt }]
      : [];
  });

  return {
    kind: "READY",
    plan: {
      bookId: book.id,
      extractionId: extraction.id,
      canonicalPath: extraction.canonicalPath,
      markdown,
      repairedCharacters: layer.repairedCharacters,
      pages: layerPages.flatMap((page, index) => {
        const text = layer.texts[index] ?? "";
        return text === page.text ? [] : [{ extractionId: extraction.id, pageNumber: page.pageNumber, text }];
      }),
      chapters: repairs,
      renamedChapters,
      skippedChapters,
      excerpts,
      analyses,
    },
  };
}

// Keeps a copy of the database and of every file it is about to replace, then writes the files and, in one transaction,
// the database. Files go first: if the run stops half way, asking again finds the stored pages still unrepaired and
// finishes the job, where the reverse order would find nothing left to do while the files stayed wrong.
export async function applyTextLayerRepair(plan: TextLayerRepairPlan): Promise<{ backupDir: string }> {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const backupDir = dataPath("backups", `before-text-repair-${plan.bookId.slice(0, 8)}-${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });
  await copyDatabaseTo(path.join(backupDir, "studio.db"));
  for (const file of [plan.canonicalPath, ...plan.chapters.map((chapter) => chapter.contentPath)]) {
    const target = path.join(backupDir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(dataPath(file), target);
  }

  await writeFileAtomic(dataPath(plan.canonicalPath), plan.markdown);
  for (const chapter of plan.chapters) await writeChapterFile(chapter.contentPath, chapter.content);
  await writeTextLayerRepair({
    pages: plan.pages,
    chapters: plan.chapters.map(({ id, title, contentHash }) => ({ id, title, contentHash })),
    excerpts: plan.excerpts,
    analyses: plan.analyses,
  });
  logger.info("Text layer repaired", {
    bookId: plan.bookId,
    repairedCharacters: plan.repairedCharacters,
    pages: plan.pages.length,
    chapters: plan.chapters.length,
    excerpts: plan.excerpts.length,
  });
  return { backupDir };
}
