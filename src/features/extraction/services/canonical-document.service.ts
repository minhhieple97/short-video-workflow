import { bookDirectory } from "@/features/books/services/book-files";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { assembleCanonicalMarkdown, type CanonicalDocument } from "../domain/canonical-document";
import { listExtractionPages } from "../repositories/extraction-page.repository";
import { findExtraction, setCanonicalPath } from "../repositories/extraction.repository";

const logger = createLogger("extraction.canonical");

export const canonicalMarkdownPath = (bookId: string, extractionId: string) =>
  `${bookDirectory(bookId)}/extractions/${extractionId}/canonical.md`;

export interface AssembledExtraction extends CanonicalDocument {
  path: string;
}

// Builds the canonical markdown from the stored page texts, writes it under the book and records its path. It refuses
// while any page has no result, so a partly extracted book is never presented as complete. The offsets are not stored:
// they are a pure function of the page texts, which do not change once every page has a result.
export async function assembleExtractionDocument(extractionId: string): Promise<AssembledExtraction> {
  const extraction = await findExtraction(extractionId);
  if (!extraction) throw new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");
  if (extraction.pageCount === null) {
    throw new AppError("EXTRACTION_NOT_INSPECTED", "PDF chưa được kiểm tra nên chưa biết số trang.", 409);
  }

  const pages = await listExtractionPages(extractionId);
  const unfinished = pages.filter((page) => page.status !== "EXTRACTED" || page.text === null);
  if (unfinished.length > 0 || pages.length !== extraction.pageCount) {
    throw new AppError("EXTRACTION_INCOMPLETE", "Còn trang chưa có kết quả nên chưa thể ghép tài liệu.", 409, {
      details: {
        unfinishedPages: unfinished.map((page) => page.pageNumber),
        storedPages: pages.length,
        expectedPages: extraction.pageCount,
      },
    });
  }

  const document = assembleCanonicalMarkdown(
    pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text ?? "" })),
    extraction.pageCount,
  );
  const path = canonicalMarkdownPath(extraction.bookId, extractionId);
  await writeFileAtomic(dataPath(path), document.markdown);
  await setCanonicalPath(extractionId, path);
  logger.info("Canonical document written", {
    extractionId,
    pages: extraction.pageCount,
    characters: document.markdown.length,
  });
  return { ...document, path };
}
