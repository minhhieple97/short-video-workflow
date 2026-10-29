import fs from "node:fs/promises";

import { bookDirectory } from "@/features/books/services/book-files";
import { createNotebookChapterDetector } from "@/features/notebooklm/services/notebook-chapter-detector";
import { NOTEBOOKLM_NOT_CONFIGURED_MESSAGE } from "@/features/notebooklm/services/notebook-studio.service";
import type { OcrOperation } from "@/generated/prisma/client";
import { IntegrationError } from "@/server/integrations/integration-error";
import { withProviderCooldown } from "@/features/jobs/services/provider-cooldown.service";
import { createOcrProvider } from "@/server/ocr";
import type { OcrProvider } from "@/server/ocr/ocr-provider";
import { PdfError, type PopplerConfig } from "@/server/pdf/poppler";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";
import { createLogger } from "@/shared/logger";

import { assembleCanonicalMarkdown } from "../domain/canonical-document";
import { verifyProposedChapters } from "../domain/chapter-detection";
import { buildChapterOutline } from "../domain/chapter-outline";
import { toExtractionStatus, type ExtractionStatus } from "../domain/extraction-status";
import { parseChunkPlan } from "../domain/ocr-chunk-plan";
import type { PlannedOcrChunk } from "../domain/ocr-results";
import {
  listExtractionPages,
  listPageNumbersWithStatus,
  markPagesUnsendable,
  requeueOrphanedOcrPages,
} from "../repositories/extraction-page.repository";
import {
  findExtractionWithBook,
  holdExtraction,
  moveExtractionStatus,
  recordExtractionProgress,
  recordExtractionTransientFailure,
} from "../repositories/extraction.repository";
import { countOcrOperations, findOpenOcrOperation } from "../repositories/ocr-operation.repository";
import { assembleExtractionDocument } from "./canonical-document.service";
import type { ChapterDetector } from "./chapter-detector";
import {
  CHAPTERS_NOT_DETECTED_MESSAGE,
  createChaptersFromCanonical,
  createChaptersFromRanges,
} from "./extraction-chapters.service";
import { planOcrOperation } from "./ocr-budget.service";
import { buildOcrChunks, materializeOcrChunks } from "./ocr-chunks.service";
import { collectOcrOperation, submitOcrOperation, type OcrChunkSpec } from "./ocr-operation.service";
import { extractPdfPages } from "./text-extraction.service";

const logger = createLogger("extraction.run");

// A run that keeps failing for a temporary reason (outage, rate limit, lost answer) stops after this many tries in a row.
export const MAX_OCR_TRANSIENT_FAILURES = 8;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;
// First look at a batch after submitting it; afterwards the provider says when to look again.
export const OCR_FIRST_POLL_MS = 60_000;
// Each step moves the run's status forward, so a handful always reaches a waiting or final state.
const MAX_STEPS = 12;
const LISTED_FAILED_PAGES = 10;

export function ocrBackoffMs(failures: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}

export interface ExtractionRunDeps {
  poppler: PopplerConfig;
  maxPages: number;
  // Throws an IntegrationError (OCR_NOT_CONFIGURED) when no provider can be used; only called once OCR is needed.
  createOcrProvider: () => OcrProvider;
  extraChapterPatterns?: readonly string[];
  // Asked where chapters start when the local parser finds none; null when NotebookLM is not set up.
  chapterDetector?: ChapterDetector | null;
}

export function defaultExtractionRunDeps(): ExtractionRunDeps {
  const { pdf, import: importConfig } = getAppConfig();
  return {
    poppler: { binDir: pdf.popplerBinDir, timeoutMs: pdf.toolTimeoutMs },
    maxPages: pdf.maxPages,
    createOcrProvider: () => createOcrProvider(),
    extraChapterPatterns: importConfig.extraChapterPatterns,
    chapterDetector: createNotebookChapterDetector(),
  };
}

export type ExtractionRunOutcome =
  | { kind: "COMPLETED" }
  | { kind: "NEEDS_CHAPTERS"; message: string }
  // A remote OCR batch is pending, or a temporary failure is being waited out: run again after retryAfterMs.
  | { kind: "WAITING"; retryAfterMs: number }
  // The run cannot go on by itself; the reason is stored on the run and the user decides (retry, raise the ceiling…).
  | { kind: "STOPPED"; status: ExtractionStatus; code: string; message: string };

type Extraction = NonNullable<Awaited<ReturnType<typeof findExtractionWithBook>>>;
type StepResult = ExtractionRunOutcome | null;

const ocrWorkDir = (extraction: Extraction, requestKey: string) =>
  dataPath(bookDirectory(extraction.bookId), "extractions", extraction.id, "ocr", requestKey);
const ocrRootDir = (extraction: Extraction) =>
  dataPath(bookDirectory(extraction.bookId), "extractions", extraction.id, "ocr");

async function hold(extractionId: string, code: string, message: string): Promise<ExtractionRunOutcome> {
  await holdExtraction(extractionId, { code, message });
  logger.warn("Extraction held", { extractionId, code });
  return { kind: "STOPPED", status: "OCR_PENDING", code, message };
}

// Runs the PDF book's extraction as far as it can go without waiting: text layer, OCR of the pages that need it, the
// canonical document and the chapters. Every step starts from what is stored, so running it again after a crash, a
// deferral or a retry picks up where the run stands and never reads, sends or pays for a page twice.
export async function runExtraction(
  extractionId: string,
  deps: ExtractionRunDeps = defaultExtractionRunDeps(),
  signal?: AbortSignal,
): Promise<ExtractionRunOutcome> {
  for (let step = 0; step < MAX_STEPS; step += 1) {
    signal?.throwIfAborted();
    const extraction = await findExtractionWithBook(extractionId);
    if (!extraction) throw new NotFoundError("EXTRACTION_NOT_FOUND", "Không tìm thấy lần trích xuất.");
    const status = toExtractionStatus(extraction.status);
    switch (status) {
      case "QUEUED":
      case "INSPECTING":
      case "EXTRACTING": {
        const outcome = await extractPdfPages(extractionId, deps, signal);
        if (outcome.status === "FAILED") {
          return { kind: "STOPPED", status: "FAILED", code: outcome.code, message: outcome.message };
        }
        break;
      }
      case "OCR_PENDING": {
        const outcome = await advanceOcr(extraction, deps, signal);
        if (outcome) return outcome;
        break;
      }
      case "ASSEMBLING": {
        const document = await assembleExtractionDocument(extractionId);
        const chapters = await createChaptersFromCanonical({
          extractionId,
          bookId: extraction.bookId,
          markdown: document.markdown,
          extraChapterPatterns: deps.extraChapterPatterns,
        });
        if (chapters.kind === "UNDETECTED") logger.info("Asking for chapter starts", { extractionId });
        break;
      }
      case "DETECTING_CHAPTERS": {
        const outcome = await detectChapters(extraction, deps, signal);
        if (outcome) return outcome;
        break;
      }
      case "COMPLETED":
        return { kind: "COMPLETED" };
      case "NEEDS_CHAPTERS":
        return { kind: "NEEDS_CHAPTERS", message: extraction.errorMessage ?? CHAPTERS_NOT_DETECTED_MESSAGE };
      case "PARTIAL":
      case "FAILED":
      case "CANCELLED":
        return {
          kind: "STOPPED",
          status,
          code: extraction.errorCode ?? `EXTRACTION_${status}`,
          message: extraction.errorMessage ?? "Lần trích xuất đã dừng.",
        };
    }
  }
  throw new AppError("EXTRACTION_NO_PROGRESS", "Lần trích xuất không tiến triển.", 500, { details: { extractionId } });
}

async function stopAtNeedsChapters(extractionId: string, code: string, message: string): Promise<ExtractionRunOutcome> {
  await moveExtractionStatus(extractionId, ["DETECTING_CHAPTERS"], {
    status: "NEEDS_CHAPTERS",
    errorCode: code,
    errorMessage: message,
  });
  logger.warn("Chapters could not be established", { extractionId, code });
  return { kind: "STOPPED", status: "NEEDS_CHAPTERS", code, message };
}

// The local parser found no chapter. The detector proposes chapter starts from an outline of page heads, and nothing is
// created unless every proposed start is found in the text where it is said to be.
async function detectChapters(
  extraction: Extraction,
  deps: ExtractionRunDeps,
  signal?: AbortSignal,
): Promise<StepResult> {
  if (!deps.chapterDetector) {
    const message = `${CHAPTERS_NOT_DETECTED_MESSAGE} ${NOTEBOOKLM_NOT_CONFIGURED_MESSAGE}`;
    await moveExtractionStatus(extraction.id, ["DETECTING_CHAPTERS"], {
      status: "NEEDS_CHAPTERS",
      errorCode: "CHAPTERS_NOT_DETECTED",
      errorMessage: message,
    });
    return { kind: "NEEDS_CHAPTERS", message };
  }
  const pageCount = extraction.pageCount ?? 0;
  const pages = (await listExtractionPages(extraction.id)).map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text ?? "",
  }));
  const document = assembleCanonicalMarkdown(pages, pageCount);
  const outline = buildChapterOutline(pages);
  if (outline.markdown.length === 0) {
    return stopAtNeedsChapters(extraction.id, "BOOK_HAS_NO_TEXT", "Sách không có chữ nào để xác định chương.");
  }

  let proposed;
  const detector = deps.chapterDetector;
  try {
    proposed = await withProviderCooldown("notebooklm", () =>
      detector.detect(
        {
          extractionId: extraction.id,
          book: { id: extraction.bookId, title: extraction.book.title },
          outline,
          pageCount,
        },
        signal,
      ),
    );
  } catch (error) {
    if (signal?.aborted || !(error instanceof IntegrationError)) throw error;
    if (error.kind === "AUTH" || error.kind === "REJECTED") {
      return stopAtNeedsChapters(extraction.id, error.code, error.message);
    }
    return transientFailure(extraction.id, {
      kind: error.kind,
      code: error.code,
      message: error.message,
      retryAfterMs: error.retryAfterMs ?? null,
    });
  }

  const verification = verifyProposedChapters(proposed, document, pages, pageCount);
  if (!verification.ok) {
    return stopAtNeedsChapters(
      extraction.id,
      "CHAPTER_DETECTION_REJECTED",
      `Chương do NotebookLM đề xuất không khớp văn bản nên chưa tạo: ${verification.problem}`,
    );
  }
  await createChaptersFromRanges({
    extractionId: extraction.id,
    bookId: extraction.bookId,
    markdown: document.markdown,
    ranges: verification.chapters,
    from: "DETECTING_CHAPTERS",
  });
  logger.info("Chapters detected", {
    extractionId: extraction.id,
    chapters: verification.chapters.length,
    frontMatterPages: verification.frontMatterPages.length,
    tocPages: verification.tocPages,
  });
  return null;
}

async function advanceOcr(extraction: Extraction, deps: ExtractionRunDeps, signal?: AbortSignal): Promise<StepResult> {
  const open = await findOpenOcrOperation(extraction.id);
  if (open) return continueOperation(extraction, open, deps, signal);

  await requeueOrphanedOcrPages(extraction.id);
  const pending = await listPageNumbersWithStatus(extraction.id, "NEEDS_OCR");
  if (pending.length > 0) return planAndSubmit(extraction, pending, deps, signal);
  return finishOcr(extraction);
}

// Every page has its OCR outcome. Pages that failed keep the run PARTIAL (never silently skipped); otherwise the run
// moves on to assembling the document.
async function finishOcr(extraction: Extraction): Promise<StepResult> {
  await fs.rm(ocrRootDir(extraction), { recursive: true, force: true });
  const failed = await listPageNumbersWithStatus(extraction.id, "FAILED");
  if (failed.length === 0) {
    await moveExtractionStatus(extraction.id, ["OCR_PENDING"], {
      status: "ASSEMBLING",
      errorCode: null,
      errorMessage: null,
    });
    return null;
  }
  const listed = failed.slice(0, LISTED_FAILED_PAGES).join(", ");
  const message =
    `${failed.length} trang chưa đọc được (trang ${listed}${failed.length > LISTED_FAILED_PAGES ? ", …" : ""}). ` +
    "Thử lại sẽ chỉ gửi lại các trang này.";
  await moveExtractionStatus(extraction.id, ["OCR_PENDING"], {
    status: "PARTIAL",
    errorCode: "OCR_PAGES_FAILED",
    errorMessage: message,
  });
  return { kind: "STOPPED", status: "PARTIAL", code: "OCR_PAGES_FAILED", message };
}

function openProvider(deps: ExtractionRunDeps): OcrProvider | IntegrationError {
  try {
    return deps.createOcrProvider();
  } catch (error) {
    if (error instanceof IntegrationError) return error;
    throw error;
  }
}

async function planAndSubmit(
  extraction: Extraction,
  pending: readonly number[],
  deps: ExtractionRunDeps,
  signal?: AbortSignal,
): Promise<StepResult> {
  const provider = openProvider(deps);
  if (provider instanceof IntegrationError) return hold(extraction.id, provider.code, provider.message);

  // The key is fixed by how many operations the run already has, so a step replayed after a crash reuses it.
  const requestKey = `${extraction.id}-ocr-${(await countOcrOperations(extraction.id)) + 1}`;
  const outDir = ocrWorkDir(extraction, requestKey);
  let built;
  try {
    built = await buildOcrChunks({
      sourcePath: dataPath(extraction.book.sourceFilePath),
      pageNumbers: pending,
      limits: provider.limits,
      outDir,
      chunkPrefix: "chunk",
      poppler: deps.poppler,
      signal,
    });
  } catch (error) {
    if (error instanceof PdfError) return hold(extraction.id, error.code, error.message);
    throw error;
  }
  if (built.oversizedPages.length > 0) {
    await markPagesUnsendable(extraction.id, built.oversizedPages, "OCR_PAGE_TOO_LARGE");
  }
  if (built.chunks.length === 0) return null;

  let operation: OcrOperation;
  try {
    operation = await planOcrOperation({
      provider,
      extractionId: extraction.id,
      requestKey,
      pageCount: built.chunks.reduce((total, chunk) => total + chunk.pageNumbers.length, 0),
      chunkPlan: built.chunks,
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await fs.rm(outDir, { recursive: true, force: true });
    return hold(extraction.id, error.code, error.message);
  }
  return submit(extraction, operation, provider, built.chunks, signal);
}

async function continueOperation(
  extraction: Extraction,
  operation: OcrOperation,
  deps: ExtractionRunDeps,
  signal?: AbortSignal,
): Promise<StepResult> {
  const plan = parseChunkPlan(operation.chunkPlanJson);
  if (!plan) {
    return hold(extraction.id, "OCR_PLAN_MISSING", "Lô OCR đang mở không còn bản đồ trang nên không thể tiếp tục.");
  }
  const provider = openProvider(deps);
  if (provider instanceof IntegrationError) return hold(extraction.id, provider.code, provider.message);
  if (provider.id !== operation.provider || provider.model !== operation.model) {
    return hold(
      extraction.id,
      "OCR_PROVIDER_CHANGED",
      `Lô OCR đang mở thuộc ${operation.provider} (${operation.model}); hệ thống không tự đổi nhà cung cấp OCR.`,
    );
  }
  if (operation.status === "SUBMITTED") return collect(extraction, operation, provider, plan, signal);

  let chunks: OcrChunkSpec[];
  try {
    chunks = await materializeOcrChunks({
      sourcePath: dataPath(extraction.book.sourceFilePath),
      plan,
      outDir: ocrWorkDir(extraction, operation.requestKey),
      poppler: deps.poppler,
      signal,
    });
  } catch (error) {
    if (error instanceof PdfError) return hold(extraction.id, error.code, error.message);
    throw error;
  }
  return submit(extraction, operation, provider, chunks, signal);
}

async function submit(
  extraction: Extraction,
  operation: OcrOperation,
  provider: OcrProvider,
  chunks: readonly OcrChunkSpec[],
  signal?: AbortSignal,
): Promise<StepResult> {
  let outcome;
  try {
    outcome = await withProviderCooldown("mistral", async () => {
      const result = await submitOcrOperation({ provider, operationId: operation.id, chunks, signal });
      if (result.status === "RETRY_LATER" && result.kind === "QUOTA") {
        throw new IntegrationError(result.code, result.message, "QUOTA", {
          retryAfterMs: result.retryAfterMs ?? undefined,
        });
      }
      return result;
    });
  } catch (error) {
    return providerFailure(extraction.id, error, signal);
  }
  switch (outcome.status) {
    case "SUBMITTED":
      await recordExtractionProgress(extraction.id);
      logger.info("OCR batch submitted", { extractionId: extraction.id, operationId: operation.id });
      return { kind: "WAITING", retryAfterMs: OCR_FIRST_POLL_MS };
    case "COMPLETED":
    case "FAILED":
      await settledOperation(extraction, operation);
      return null;
    case "UNKNOWN_OUTCOME":
      return transientFailure(extraction.id, {
        code: "OCR_SUBMIT_UNKNOWN",
        message: "Chưa rõ lô OCR đã được nhận hay chưa; sẽ đối soát trước khi gửi lại.",
        retryAfterMs: null,
      });
    case "RETRY_LATER":
      if (outcome.kind === "AUTH") return hold(extraction.id, outcome.code, outcome.message);
      return transientFailure(extraction.id, outcome);
  }
}

async function collect(
  extraction: Extraction,
  operation: OcrOperation,
  provider: OcrProvider,
  plan: readonly PlannedOcrChunk[],
  signal?: AbortSignal,
): Promise<StepResult> {
  let outcome;
  try {
    outcome = await withProviderCooldown("mistral", () =>
      collectOcrOperation({ provider, operationId: operation.id, plan, signal }),
    );
  } catch (error) {
    return providerFailure(extraction.id, error, signal);
  }
  switch (outcome.status) {
    case "PENDING":
      await recordExtractionProgress(extraction.id);
      return { kind: "WAITING", retryAfterMs: outcome.retryAfterMs };
    case "COMPLETED":
    case "FAILED":
      await settledOperation(extraction, operation);
      return null;
    case "CANCELLED":
      // Cancelled outside this app: sending the pages again is left to the user rather than done behind their back.
      await settledOperation(extraction, operation);
      return hold(
        extraction.id,
        "OCR_CANCELLED_REMOTELY",
        "Lô OCR đã bị huỷ ở phía nhà cung cấp. Thử lại để gửi lại các trang này.",
      );
  }
}

async function settledOperation(extraction: Extraction, operation: OcrOperation): Promise<void> {
  await fs.rm(ocrWorkDir(extraction, operation.requestKey), { recursive: true, force: true });
  await recordExtractionProgress(extraction.id);
}

async function providerFailure(extractionId: string, error: unknown, signal?: AbortSignal): Promise<StepResult> {
  if (signal?.aborted || !(error instanceof IntegrationError)) throw error;
  if (error.kind === "AUTH" || error.kind === "REJECTED") return hold(extractionId, error.code, error.message);
  return transientFailure(extractionId, {
    kind: error.kind,
    code: error.code,
    message: error.message,
    retryAfterMs: error.retryAfterMs ?? null,
  });
}

async function transientFailure(
  extractionId: string,
  failure: { code: string; message: string; retryAfterMs: number | null; kind?: string },
): Promise<ExtractionRunOutcome> {
  if (failure.kind === "QUOTA") {
    await holdExtraction(extractionId, failure);
    return { kind: "WAITING", retryAfterMs: Math.max(60_000, failure.retryAfterMs ?? 60_000) };
  }
  const failures = await recordExtractionTransientFailure(extractionId, failure);
  if (failures > MAX_OCR_TRANSIENT_FAILURES) {
    return hold(extractionId, failure.code, `${failure.message} (đã thử lại ${MAX_OCR_TRANSIENT_FAILURES} lần)`);
  }
  logger.info("OCR waiting out a temporary failure", { extractionId, code: failure.code, failures });
  return { kind: "WAITING", retryAfterMs: failure.retryAfterMs ?? ocrBackoffMs(failures) };
}
