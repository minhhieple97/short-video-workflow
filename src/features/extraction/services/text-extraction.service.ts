import { bookDirectory } from "@/features/books/services/book-files";
import { countPageImages, extractTextLayer, inspectPdf, PdfError, type PopplerConfig } from "@/server/pdf/poppler";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { classifyPage } from "../domain/page-classification";
import {
  countExtractedByMethod,
  countPagesByStatus,
  storeClassifiedPages,
} from "../repositories/extraction-page.repository";
import { findExtractionWithBook, moveExtractionStatus } from "../repositories/extraction.repository";

const logger = createLogger("extraction.text");

// The run is at or before the text-layer step; anything later means the step already ran.
const BEFORE_OCR = ["QUEUED", "INSPECTING", "EXTRACTING"];

export type TextExtractionOutcome =
  | { status: "FAILED"; code: string; message: string }
  | { status: "OCR_PENDING" | "ASSEMBLING"; pageCount: number; text: number; empty: number; ocr: number };

export interface TextExtractionDeps {
  poppler: PopplerConfig;
  maxPages: number;
}

function defaultDeps(): TextExtractionDeps {
  const { pdf } = getAppConfig();
  return { poppler: { binDir: pdf.popplerBinDir, timeoutMs: pdf.toolTimeoutMs }, maxPages: pdf.maxPages };
}

async function fail(extractionId: string, code: string, message: string): Promise<TextExtractionOutcome> {
  await moveExtractionStatus(extractionId, BEFORE_OCR, { status: "FAILED", errorCode: code, errorMessage: message });
  logger.warn("PDF extraction failed", { extractionId, code });
  return { status: "FAILED", code, message };
}

// Reads the PDF once: checks it opens and is within the page limit, reads every page's text layer, and keeps the text
// of pages where it is usable. Only the other pages are left for OCR, each with its reason, so OCR is paid for only
// where it is needed. Nothing is sent anywhere.
export async function extractPdfPages(
  extractionId: string,
  deps: TextExtractionDeps = defaultDeps(),
  signal?: AbortSignal,
): Promise<TextExtractionOutcome> {
  const extraction = await findExtractionWithBook(extractionId);
  if (!extraction) throw new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");
  if (extraction.status === "FAILED") {
    return {
      status: "FAILED",
      code: extraction.errorCode ?? "EXTRACTION_FAILED",
      message: extraction.errorMessage ?? "",
    };
  }
  if (extraction.book.sourceFormat !== "pdf") {
    return fail(extractionId, "EXTRACTION_NOT_PDF", "Sách này không phải PDF.");
  }
  if (BEFORE_OCR.includes(extraction.status)) {
    await moveExtractionStatus(extractionId, BEFORE_OCR, { status: "INSPECTING" });
    const source = dataPath(extraction.book.sourceFilePath);
    try {
      const info = await inspectPdf(source, deps.poppler, signal);
      if (info.pageCount > deps.maxPages) {
        return await fail(
          extractionId,
          "PDF_TOO_MANY_PAGES",
          `Sách có ${info.pageCount} trang, vượt giới hạn ${deps.maxPages} trang (MAX_PDF_PAGES).`,
        );
      }
      await moveExtractionStatus(extractionId, BEFORE_OCR, { status: "EXTRACTING", pageCount: info.pageCount });
      const workFile = dataPath(bookDirectory(extraction.book.id), "extractions", extractionId, "text-layer.txt");
      const texts = await extractTextLayer(source, info.pageCount, workFile, deps.poppler, signal);
      const images = await countPageImages(source, deps.poppler, signal);
      await storeClassifiedPages(
        extractionId,
        texts.map((text, index) => ({
          pageNumber: index + 1,
          classification: classifyPage(text, images.get(index + 1) ?? 0),
        })),
      );
    } catch (error) {
      if (error instanceof PdfError) return fail(extractionId, error.code, error.message);
      throw error;
    }
  }

  const counts = await countPagesByStatus(extractionId);
  const ocr = (counts.NEEDS_OCR ?? 0) + (counts.OCR_SUBMITTED ?? 0) + (counts.FAILED ?? 0);
  const status = ocr > 0 ? "OCR_PENDING" : "ASSEMBLING";
  await moveExtractionStatus(extractionId, ["EXTRACTING"], { status });
  const [methods, current] = await Promise.all([
    countExtractedByMethod(extractionId),
    findExtractionWithBook(extractionId),
  ]);
  logger.info("PDF text layer read", { extractionId, pageCount: current?.pageCount, ocr });
  return {
    status,
    pageCount: current?.pageCount ?? 0,
    text: (methods.TEXT ?? 0) + (methods.OCR ?? 0),
    empty: methods.EMPTY ?? 0,
    ocr,
  };
}
