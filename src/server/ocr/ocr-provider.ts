import type { CallOptions } from "@/server/integrations/call-options";

export interface OcrChunkLimits {
  maxPages: number;
  maxBytes: number;
}

export interface OcrInputChunk {
  chunkId: string;
  // Absolute path already resolved through storage/safe-path.
  filePath: string;
  pageCount: number;
  bytes: number;
}

export interface OcrStartRequest {
  // Stable across replays so an adapter can recognise a submission it has already made.
  requestKey: string;
  chunks: OcrInputChunk[];
}

export interface OcrPageResult {
  // 0-based position inside the submitted chunk; the caller maps it back to the source PDF page.
  pageIndex: number;
  markdown: string;
  // 0..1, or null when the provider does not report one. Never invented.
  confidence: number | null;
}

export type OcrChunkResult =
  | { chunkId: string; status: "ok"; pages: OcrPageResult[] }
  | { chunkId: string; status: "failed"; code: string; message: string };

export type OcrStartResult =
  { status: "completed"; chunks: OcrChunkResult[] } | { status: "submitted"; operationRef: string };

// "completed" means the provider finished processing; individual chunks inside it may still have failed, and a chunk
// the provider returned nothing for is simply absent: the caller compares against what it submitted.
export type OcrOperationStatus =
  | { status: "pending"; retryAfterMs: number }
  | { status: "completed"; chunks: OcrChunkResult[] }
  | { status: "failed"; code: string; message: string; retryable: boolean }
  | { status: "cancelled" };

export interface OcrProvider {
  readonly id: string;
  readonly model: string;
  readonly limits: OcrChunkLimits;
  estimateCostUsd(pageCount: number): number;
  // Idempotent per requestKey: a replay returns the existing operation instead of submitting again.
  start(request: OcrStartRequest, options?: CallOptions): Promise<OcrStartResult>;
  // operationRef is opaque to callers and safe to persist.
  poll(operationRef: string, options?: CallOptions): Promise<OcrOperationStatus>;
  // Reconciles an unknown submit outcome: the operation made for this requestKey, or null if none exists.
  findOperation(requestKey: string, options?: CallOptions): Promise<string | null>;
  cancel(operationRef: string, options?: CallOptions): Promise<void>;
  // Removes provider-side copies once the output is stored locally; safe to call repeatedly.
  cleanup(operationRef: string, options?: CallOptions): Promise<void>;
}
