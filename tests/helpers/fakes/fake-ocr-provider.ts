import { IntegrationError } from "@/server/integrations/integration-error";
import type { CallOptions } from "@/server/integrations/call-options";
import type {
  OcrChunkLimits,
  OcrChunkResult,
  OcrInputChunk,
  OcrOperationStatus,
  OcrProvider,
  OcrStartRequest,
  OcrStartResult,
} from "@/server/ocr/ocr-provider";

export interface FakeOcrOptions {
  // "immediate" finishes inside start(); "batch" returns an operation that settle() completes.
  mode: "immediate" | "batch";
  limits?: OcrChunkLimits;
  usdPerPage?: number;
}

interface FakeOperation {
  chunks: OcrInputChunk[];
  state: "pending" | "completed" | "cancelled";
}

export class FakeOcrProvider implements OcrProvider {
  readonly id = "fake-ocr";
  readonly model = "fake-ocr-1";
  readonly limits: OcrChunkLimits;
  readonly cleanedOperations = new Set<string>();

  private readonly usdPerPage: number;
  private readonly operations = new Map<string, FakeOperation>();
  private readonly operationByKey = new Map<string, string>();
  private submissions = 0;

  constructor(private readonly options: FakeOcrOptions) {
    this.limits = options.limits ?? { maxPages: 50, maxBytes: 40 * 1024 * 1024 };
    this.usdPerPage = options.usdPerPage ?? 0.0005;
  }

  get submissionCount(): number {
    return this.submissions;
  }

  estimateCostUsd(pageCount: number): number {
    return pageCount * this.usdPerPage;
  }

  async start(request: OcrStartRequest, options?: CallOptions): Promise<OcrStartResult> {
    options?.signal?.throwIfAborted();
    this.assertWithinLimits(request.chunks);

    const existing = this.operationByKey.get(request.requestKey);
    if (existing) return this.describeStart(existing);

    this.submissions += 1;
    const operationRef = `fake-op-${this.submissions}`;
    this.operations.set(operationRef, {
      chunks: request.chunks,
      state: this.options.mode === "immediate" ? "completed" : "pending",
    });
    this.operationByKey.set(request.requestKey, operationRef);
    return this.describeStart(operationRef);
  }

  async poll(operationRef: string, options?: CallOptions): Promise<OcrOperationStatus> {
    options?.signal?.throwIfAborted();
    const operation = this.requireOperation(operationRef);
    if (operation.state === "cancelled") return { status: "cancelled" };
    if (operation.state === "pending") return { status: "pending", retryAfterMs: 1_000 };
    return { status: "completed", chunks: resultsFor(operation.chunks) };
  }

  async findOperation(requestKey: string, options?: CallOptions): Promise<string | null> {
    options?.signal?.throwIfAborted();
    return this.options.mode === "immediate" ? null : (this.operationByKey.get(requestKey) ?? null);
  }

  async cancel(operationRef: string, options?: CallOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    const operation = this.requireOperation(operationRef);
    if (operation.state === "pending") operation.state = "cancelled";
  }

  async cleanup(operationRef: string, options?: CallOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    this.cleanedOperations.add(operationRef);
  }

  settle(operationRef: string): void {
    const operation = this.requireOperation(operationRef);
    if (operation.state === "pending") operation.state = "completed";
  }

  private describeStart(operationRef: string): OcrStartResult {
    if (this.options.mode === "batch") return { status: "submitted", operationRef };
    return { status: "completed", chunks: resultsFor(this.requireOperation(operationRef).chunks) };
  }

  private assertWithinLimits(chunks: OcrInputChunk[]): void {
    const oversized = chunks.find(
      (chunk) => chunk.pageCount > this.limits.maxPages || chunk.bytes > this.limits.maxBytes,
    );
    if (oversized) {
      throw new IntegrationError(
        "OCR_CHUNK_TOO_LARGE",
        `Chunk ${oversized.chunkId} exceeds the provider limits.`,
        "REJECTED",
      );
    }
  }

  private requireOperation(operationRef: string): FakeOperation {
    const operation = this.operations.get(operationRef);
    if (!operation) throw new IntegrationError("OCR_OPERATION_UNKNOWN", "Unknown operation.", "REJECTED");
    return operation;
  }
}

function resultsFor(chunks: OcrInputChunk[]): OcrChunkResult[] {
  return chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    status: "ok",
    pages: Array.from({ length: chunk.pageCount }, (_, pageIndex) => ({
      pageIndex,
      markdown: `Trang ${pageIndex + 1} của ${chunk.chunkId}`,
      confidence: null,
    })),
  }));
}
