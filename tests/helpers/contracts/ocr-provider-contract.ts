import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/server/integrations/integration-error";
import type {
  OcrChunkResult,
  OcrInputChunk,
  OcrOperationStatus,
  OcrProvider,
  OcrStartRequest,
} from "@/server/ocr/ocr-provider";

export interface OcrContractHarness {
  provider: OcrProvider;
  // Drives a submitted operation to completion; a no-op for providers that finish inside start().
  settle(operationRef: string): void | Promise<void>;
  // Providers that read the chunk file need a real one; the default is a path that is never opened.
  makeChunk?(chunkId: string, pageCount: number): OcrInputChunk;
}

const defaultChunk = (chunkId: string, pageCount: number): OcrInputChunk => ({
  chunkId,
  filePath: `/unused/${chunkId}.pdf`,
  pageCount,
  bytes: 1_024,
});

const chunkOf = (harness: OcrContractHarness, chunkId: string, pageCount: number): OcrInputChunk =>
  (harness.makeChunk ?? defaultChunk)(chunkId, pageCount);

async function runToCompletion(harness: OcrContractHarness, request: OcrStartRequest): Promise<OcrChunkResult[]> {
  const started = await harness.provider.start(request);
  if (started.status === "completed") return started.chunks;

  await harness.settle(started.operationRef);
  const polled = await harness.provider.poll(started.operationRef);
  if (polled.status !== "completed") throw new Error(`Expected a completed operation, got ${polled.status}`);
  return polled.chunks;
}

// A cancellation may take a poll or two to show, but it must show without the operation ever completing.
async function pollUntilSettled(provider: OcrProvider, operationRef: string): Promise<OcrOperationStatus> {
  let status = await provider.poll(operationRef);
  for (let attempt = 0; attempt < 5 && status.status === "pending"; attempt += 1) {
    status = await provider.poll(operationRef);
  }
  return status;
}

export function describeOcrProviderContract(name: string, createHarness: () => OcrContractHarness): void {
  describe(`OcrProvider contract: ${name}`, () => {
    it("advertises positive chunk limits and a monotonic, non-negative cost estimate", () => {
      const { provider } = createHarness();

      expect(provider.limits.maxPages).toBeGreaterThan(0);
      expect(provider.limits.maxBytes).toBeGreaterThan(0);
      expect(provider.estimateCostUsd(0)).toBe(0);
      expect(provider.estimateCostUsd(100)).toBeGreaterThan(0);
      expect(provider.estimateCostUsd(200)).toBeGreaterThanOrEqual(provider.estimateCostUsd(100));
    });

    it("returns one result per submitted chunk with contiguous 0-based page indexes", async () => {
      const harness = createHarness();
      const chunks = [chunkOf(harness, "a", 3), chunkOf(harness, "b", 1)];

      const results = await runToCompletion(harness, { requestKey: "key-results", chunks });

      expect([...results.map((result) => result.chunkId)].sort()).toEqual(["a", "b"]);
      for (const result of results) {
        if (result.status !== "ok") throw new Error(`Chunk ${result.chunkId} failed unexpectedly`);
        const submitted = chunks.find((candidate) => candidate.chunkId === result.chunkId);
        expect(result.pages.map((page) => page.pageIndex)).toEqual(
          Array.from({ length: submitted?.pageCount ?? 0 }, (_, pageIndex) => pageIndex),
        );
        for (const page of result.pages) {
          expect(page.markdown.length).toBeGreaterThan(0);
          if (page.confidence !== null) {
            expect(page.confidence).toBeGreaterThanOrEqual(0);
            expect(page.confidence).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it("is idempotent per requestKey and lets findOperation reconcile the submission", async () => {
      const harness = createHarness();
      const { provider } = harness;
      const request = { requestKey: "key-replay", chunks: [chunkOf(harness, "a", 2)] };

      const first = await provider.start(request);
      const replay = await provider.start(request);

      if (first.status === "completed") {
        expect(replay).toEqual(first);
        return;
      }
      expect(replay).toEqual(first);
      expect(await provider.findOperation(request.requestKey)).toBe(first.operationRef);
    });

    it("finds no operation for a requestKey that was never submitted", async () => {
      const { provider } = createHarness();

      expect(await provider.findOperation("key-never-submitted")).toBeNull();
    });

    it("rejects a chunk over the advertised limits as REJECTED", async () => {
      const harness = createHarness();
      const oversized = chunkOf(harness, "big", harness.provider.limits.maxPages + 1);

      const failure = await harness.provider
        .start({ requestKey: "key-oversized", chunks: [oversized] })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(IntegrationError);
      expect((failure as IntegrationError).kind).toBe("REJECTED");
    });

    it("submits nothing when the signal is already aborted", async () => {
      const harness = createHarness();
      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.provider.start(
          { requestKey: "key-aborted", chunks: [chunkOf(harness, "a", 1)] },
          { signal: controller.signal },
        ),
      ).rejects.toThrow();
      expect(await harness.provider.findOperation("key-aborted")).toBeNull();
    });

    it("cancels a pending operation", async (context) => {
      const harness = createHarness();
      const started = await harness.provider.start({
        requestKey: "key-cancel",
        chunks: [chunkOf(harness, "a", 1)],
      });
      if (started.status === "completed") return context.skip();

      await harness.provider.cancel(started.operationRef);

      expect(await pollUntilSettled(harness.provider, started.operationRef)).toEqual({ status: "cancelled" });
    });

    it("allows cleanup to be repeated", async (context) => {
      const harness = createHarness();
      const started = await harness.provider.start({
        requestKey: "key-cleanup",
        chunks: [chunkOf(harness, "a", 1)],
      });
      if (started.status === "completed") return context.skip();
      await harness.settle(started.operationRef);

      await harness.provider.cleanup(started.operationRef);
      await expect(harness.provider.cleanup(started.operationRef)).resolves.toBeUndefined();
    });
  });
}
