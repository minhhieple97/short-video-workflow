import { IntegrationError } from "@/server/integrations/integration-error";
import type { OcrChunkResult, OcrOperationStatus, OcrPageResult } from "@/server/ocr/ocr-provider";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import type { MistralClient } from "./mistral-client";
import {
  mistralOcrBodySchema,
  mistralOutputLineSchema,
  type MistralBatchJob,
  type MistralOcrPage,
} from "./mistral-schemas";

const logger = createLogger("ocr.mistral.collect");

// Batches take minutes to hours; checking more often only spends requests.
export const POLL_INTERVAL_MS = 60_000;

type OutputLine = ReturnType<typeof mistralOutputLineSchema.parse>;

const failedChunk = (chunkId: string, code: string, message: string): OcrChunkResult => ({
  chunkId,
  status: "failed",
  code,
  message,
});

// Content-bearing responses are never attached as the error cause or quoted in the message: the markdown is book text.
function badOutput(lineNumber: number): IntegrationError {
  return new IntegrationError(
    "MISTRAL_BAD_RESPONSE",
    "Tệp kết quả của Mistral có dòng không đúng định dạng.",
    "REJECTED",
    { details: { lineNumber } },
  );
}

function parseJsonLines(text: string): OutputLine[] {
  const lines: OutputLine[] = [];
  const rawLines = text.split("\n");
  for (const [index, raw] of rawLines.entries()) {
    if (raw.trim().length === 0) continue;
    try {
      lines.push(mistralOutputLineSchema.parse(JSON.parse(raw)));
    } catch {
      throw badOutput(index + 1);
    }
  }
  return lines;
}

// Mistral's own docs disagree on whether response page indexes start at 0 or 1, so both are accepted, but only when
// they form exactly 0..n-1 or 1..n. Anything else is rejected rather than guessed.
function toPageResults(pages: MistralOcrPage[]): OcrPageResult[] | null {
  const sorted = [...pages].sort((left, right) => left.index - right.index);
  const base = sorted[0]?.index ?? 0;
  const contiguous = sorted.every((page, position) => page.index === base + position);
  if (!contiguous || base > 1) return null;

  return sorted.map((page) => ({
    pageIndex: page.index - base,
    markdown: page.markdown,
    // Exactly what Mistral reported for the page; null when it reported nothing, never an estimate.
    confidence: page.confidence_scores?.average_page_confidence_score ?? null,
  }));
}

function toChunkResult(line: OutputLine): OcrChunkResult {
  const chunkId = line.custom_id;
  const status = line.response?.status_code;
  if (status !== 200) {
    return failedChunk(
      chunkId,
      status ? `OCR_REQUEST_${status}` : "OCR_REQUEST_FAILED",
      "OCR không xử lý được đoạn này.",
    );
  }

  const body = mistralOcrBodySchema.safeParse(line.response?.body);
  if (!body.success)
    return failedChunk(chunkId, "OCR_BAD_RESPONSE_BODY", "Kết quả OCR của đoạn này không đúng định dạng.");
  const pages = toPageResults(body.data.pages);
  if (!pages) return failedChunk(chunkId, "OCR_BAD_PAGE_INDEX", "Chỉ số trang OCR trả về không liên tục.");
  return { chunkId, status: "ok", pages };
}

// Every line in the output and error files becomes one chunk result. A chunk Mistral returned nothing for is simply
// absent; the caller knows what it submitted and treats the difference as missing.
async function collectChunkResults(
  client: MistralClient,
  job: MistralBatchJob,
  signal?: AbortSignal,
): Promise<OcrChunkResult[]> {
  const results = new Map<string, OcrChunkResult>();
  const record = (result: OcrChunkResult): void => {
    results.set(
      result.chunkId,
      results.has(result.chunkId)
        ? failedChunk(result.chunkId, "OCR_DUPLICATE_RESULT", "Mistral trả về hai kết quả cho cùng một đoạn.")
        : result,
    );
  };

  if (job.output_file) {
    for (const line of parseJsonLines(await client.downloadFileText(job.output_file, signal)))
      record(toChunkResult(line));
  }
  if (job.error_file) {
    for (const line of parseJsonLines(await client.downloadFileText(job.error_file, signal))) {
      if (!results.has(line.custom_id))
        record(failedChunk(line.custom_id, "OCR_REQUEST_FAILED", "OCR không xử lý được đoạn này."));
    }
  }
  return [...results.values()];
}

// Never waits: a job still queued or running just answers "pending" and the caller comes back later.
export async function pollBatchJob(
  client: MistralClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<OcrOperationStatus> {
  const job = await client.getBatchJob(jobId, signal);
  switch (job.status) {
    case "QUEUED":
    case "RUNNING":
    case "CANCELLATION_REQUESTED":
      return { status: "pending", retryAfterMs: POLL_INTERVAL_MS };
    case "CANCELLED":
      return { status: "cancelled" };
    case "FAILED":
      return {
        status: "failed",
        code: "MISTRAL_BATCH_FAILED",
        message: "Mistral báo lô OCR thất bại.",
        retryable: false,
      };
    case "TIMEOUT_EXCEEDED":
      return {
        status: "failed",
        code: "MISTRAL_BATCH_TIMEOUT",
        message: "Lô OCR quá thời gian xử lý của Mistral.",
        retryable: true,
      };
    case "SUCCESS":
      return { status: "completed", chunks: await collectChunkResults(client, job, signal) };
  }
}

export async function cancelBatchJob(client: MistralClient, jobId: string, signal?: AbortSignal): Promise<void> {
  await client.cancelBatchJob(jobId, signal);
}

const isGone = (error: unknown): boolean => error instanceof IntegrationError && error.code === "MISTRAL_HTTP_404";

async function deleteIfPresent(client: MistralClient, fileId: string, signal?: AbortSignal): Promise<void> {
  try {
    await client.deleteFile(fileId, signal);
  } catch (error) {
    if (!isGone(error)) throw error;
  }
}

// The uploaded PDFs are only known from the request file, so that file is deleted last: if a delete fails half-way,
// calling cleanup again still finds the remaining ids.
export async function cleanupBatchJob(client: MistralClient, jobId: string, signal?: AbortSignal): Promise<void> {
  let job: MistralBatchJob;
  try {
    job = await client.getBatchJob(jobId, signal);
  } catch (error) {
    if (isGone(error)) return;
    throw error;
  }

  const requestFiles = job.input_files ?? [];
  const documentFileIds = new Set<string>();
  for (const requestFileId of requestFiles) {
    try {
      for (const raw of (await client.downloadFileText(requestFileId, signal)).split("\n")) {
        if (raw.trim().length === 0) continue;
        const fileId = documentFileIdOf(raw);
        if (fileId) documentFileIds.add(fileId);
      }
    } catch (error) {
      if (!isGone(error)) throw error;
    }
  }

  for (const fileId of [...documentFileIds, job.output_file, job.error_file, ...requestFiles]) {
    if (fileId) await deleteIfPresent(client, fileId, signal);
  }
  logger.info("Cleaned up OCR batch files", { jobId, documents: documentFileIds.size });
}

function documentFileIdOf(rawLine: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawLine);
    if (typeof parsed !== "object" || parsed === null || !("body" in parsed)) return null;
    const { body } = parsed;
    if (typeof body !== "object" || body === null || !("document" in body)) return null;
    const { document } = body;
    if (typeof document !== "object" || document === null || !("file_id" in document)) return null;
    return typeof document.file_id === "string" ? document.file_id : null;
  } catch (error) {
    logger.warn("Skipping an unreadable request line during cleanup", { error: toSafeErrorMessage(error) });
    return null;
  }
}
