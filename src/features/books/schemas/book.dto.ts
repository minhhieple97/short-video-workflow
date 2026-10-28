import type { ExtractionStatus } from "@/features/extraction/domain/extraction-status";

import type { BookStructure, ProposedSection } from "../domain/book-structure";
import type { SourceFormat } from "../domain/source-file";

export interface ImportPreview {
  importId: string;
  fileName: string;
  format: SourceFormat;
  sizeBytes: number;
  sourceHash: string;
  text: string;
  suggestedTitle: string;
  method: BookStructure["method"];
  headingDepth: number | null;
  sections: ProposedSection[];
  warnings: string[];
  duplicateOf: { id: string; title: string } | null;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  sourceFileName: string;
  sourceFormat: string;
  // The latest extraction run of a PDF book; null for a book imported from text. `hasError` is true while the run
  // carries a reason it stopped or is waiting out, so the library never shows a stuck run as simply in progress.
  extraction: { status: ExtractionStatus; hasError: boolean } | null;
  chapterCount: number;
  lessonCount: number;
  videoCount: number;
  createdAt: string;
}
