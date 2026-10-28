import { IntegrationError } from "@/server/integrations/integration-error";
import type { OcrChunkLimits, OcrInputChunk, OcrStartRequest } from "@/server/ocr/ocr-provider";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import type { MistralClient } from "./mistral-client";
import type { MistralBatchJob } from "./mistral-schemas";

const logger = createLogger("ocr.mistral.submit");

export const OCR_CHUNK_LIMITS: OcrChunkLimits = { maxPages: 50, maxBytes: 40 * 1024 * 1024 };

// The key under which a submission can be found again by anyone holding the same requestKey.
export const REQUEST_KEY_METADATA = "request_key";

const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 5;

// One OCR request per chunk. The document is referenced by file id, so nothing depends on a URL that could expire
// while the batch waits in Mistral's queue. The model is set once on the job, not per line.
export function buildOcrBatchLine(chunkId: string, fileId: string): Record<string, unknown> {
  return {
    custom_id: chunkId,
    body: {
      document: { type: "file", file_id: fileId },
      include_image_base64: false,
      table_format: "markdown",
      confidence_scores_granularity: "page",
      include_blocks: false,
    },
  };
}

export function serializeBatchRequests(lines: readonly Record<string, unknown>[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

export function assertChunksWithinLimits(chunks: readonly OcrInputChunk[], limits: OcrChunkLimits): void {
  const oversized = chunks.find((chunk) => chunk.pageCount > limits.maxPages || chunk.bytes > limits.maxBytes);
  if (oversized) {
    throw new IntegrationError(
      "OCR_CHUNK_TOO_LARGE",
      `Đoạn ${oversized.chunkId} vượt giới hạn ${limits.maxPages} trang hoặc ${Math.round(limits.maxBytes / 1024 / 1024)} MiB của OCR.`,
      "REJECTED",
    );
  }
  if (new Set(chunks.map((chunk) => chunk.chunkId)).size !== chunks.length) {
    throw new IntegrationError("OCR_DUPLICATE_CHUNK_ID", "Hai đoạn OCR có cùng mã định danh.", "REJECTED");
  }
}

// Scans the newest jobs (bounded) for one made with this request key. Used both before submitting, so a replay never
// pays twice, and after an unknown submit outcome.
export async function findBatchJobByRequestKey(
  client: MistralClient,
  requestKey: string,
  signal?: AbortSignal,
): Promise<MistralBatchJob | null> {
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const jobs = await client.listBatchJobs({ page, pageSize: LIST_PAGE_SIZE }, signal);
    const match = jobs.find((job) => job.metadata?.[REQUEST_KEY_METADATA] === requestKey);
    if (match) return match;
    if (jobs.length < LIST_PAGE_SIZE) return null;
  }
  return null;
}

const safeFileName = (chunkId: string) => `${chunkId.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

async function deleteQuietly(client: MistralClient, fileIds: readonly string[]): Promise<void> {
  for (const fileId of fileIds) {
    await client.deleteFile(fileId).catch((error: unknown) => {
      logger.warn("Could not delete an uploaded OCR file", { fileId, error: toSafeErrorMessage(error) });
    });
  }
}

export interface SubmitOptions {
  model: string;
  limits?: OcrChunkLimits;
  signal?: AbortSignal;
}

// Uploads the chunks, then the request file, then creates the batch. Returns the job id. A replay with the same
// requestKey finds the existing job and uploads and pays for nothing.
export async function submitOcrBatch(
  client: MistralClient,
  request: OcrStartRequest,
  options: SubmitOptions,
): Promise<string> {
  const { signal } = options;
  signal?.throwIfAborted();
  assertChunksWithinLimits(request.chunks, options.limits ?? OCR_CHUNK_LIMITS);

  const existing = await findBatchJobByRequestKey(client, request.requestKey, signal);
  if (existing) return existing.id;

  const uploaded: string[] = [];
  let jobCreationAttempted = false;
  try {
    const lines: Record<string, unknown>[] = [];
    for (const chunk of request.chunks) {
      const file = await client.uploadFile(
        { filePath: chunk.filePath, fileName: safeFileName(chunk.chunkId), purpose: "ocr" },
        signal,
      );
      uploaded.push(file.id);
      lines.push(buildOcrBatchLine(chunk.chunkId, file.id));
    }

    const requests = await client.uploadText(
      { content: serializeBatchRequests(lines), fileName: "ocr-requests.jsonl", purpose: "batch" },
      signal,
    );
    uploaded.push(requests.id);

    jobCreationAttempted = true;
    const job = await client.createBatchJob(
      {
        model: options.model,
        endpoint: "/v1/ocr",
        inputFileIds: [requests.id],
        metadata: { [REQUEST_KEY_METADATA]: request.requestKey },
      },
      signal,
    );
    return job.id;
  } catch (error) {
    // If creating the job lost its answer, a job may exist that still reads these files: keep them for reconciliation.
    const outcomeUnknown =
      error instanceof IntegrationError ? error.kind === "UNKNOWN_OUTCOME" : signal?.aborted === true;
    if (!(jobCreationAttempted && outcomeUnknown)) await deleteQuietly(client, uploaded);
    throw error;
  }
}
