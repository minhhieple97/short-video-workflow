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
  chapterCount: number;
  lessonCount: number;
  videoCount: number;
  createdAt: string;
}
