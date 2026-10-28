import type { CallOptions } from "@/server/integrations/call-options";
import type {
  OcrChunkLimits,
  OcrOperationStatus,
  OcrProvider,
  OcrStartRequest,
  OcrStartResult,
} from "@/server/ocr/ocr-provider";

import { cancelBatchJob, cleanupBatchJob, pollBatchJob } from "./mistral-batch-collect";
import { findBatchJobByRequestKey, OCR_CHUNK_LIMITS, submitOcrBatch } from "./mistral-batch-submit";
import type { MistralClient } from "./mistral-client";

export interface MistralBatchOcrSettings {
  model: string;
  usdPer1000Pages: number;
}

// The OcrProvider for Mistral's asynchronous OCR Batch API. start() only submits; the result arrives through poll(),
// so the worker is never held while Mistral queues the batch.
export class MistralBatchOcrProvider implements OcrProvider {
  readonly id = "mistral-batch";
  readonly model: string;
  readonly limits: OcrChunkLimits = OCR_CHUNK_LIMITS;

  constructor(
    private readonly client: MistralClient,
    private readonly settings: MistralBatchOcrSettings,
  ) {
    this.model = settings.model;
  }

  estimateCostUsd(pageCount: number): number {
    return (pageCount * this.settings.usdPer1000Pages) / 1000;
  }

  async start(request: OcrStartRequest, options?: CallOptions): Promise<OcrStartResult> {
    const operationRef = await submitOcrBatch(this.client, request, { model: this.model, signal: options?.signal });
    return { status: "submitted", operationRef };
  }

  poll(operationRef: string, options?: CallOptions): Promise<OcrOperationStatus> {
    return pollBatchJob(this.client, operationRef, options?.signal);
  }

  async findOperation(requestKey: string, options?: CallOptions): Promise<string | null> {
    const job = await findBatchJobByRequestKey(this.client, requestKey, options?.signal);
    return job?.id ?? null;
  }

  cancel(operationRef: string, options?: CallOptions): Promise<void> {
    return cancelBatchJob(this.client, operationRef, options?.signal);
  }

  cleanup(operationRef: string, options?: CallOptions): Promise<void> {
    return cleanupBatchJob(this.client, operationRef, options?.signal);
  }
}
