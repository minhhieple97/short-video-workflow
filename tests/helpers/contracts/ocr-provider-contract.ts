import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/server/integrations/integration-error";
import type { OcrChunkResult, OcrInputChunk, OcrProvider, OcrStartRequest } from "@/server/ocr/ocr-provider";

export interface OcrContractHarness {
  provider: OcrProvider;
  // Drives a submitted operation to completion; a no-op for providers that finish inside start().
  settle(operationRef: string): void | Promise<void>;
}

function chunk(chunkId: string, pageCount: number): OcrInputChunk {
  return { chunkId, filePath: `/unused/${chunkId}.pdf`, pageCount, bytes: 1_024 };
}

async function runToCompletion(harness: OcrContractHarness, request: OcrStartRequest): Promise<OcrChunkResult[]> {
  const started = await harness.provider.start(request);
  if (started.status === "completed") return started.chunks;

  await harness.settle(started.operationRef);
  const polled = await harness.provider.poll(started.operationRef);
  if (polled.status !== "completed") throw new Error(`Expected a completed operation, got ${polled.status}`);
  return polled.chunks;
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
      const chunks = [chunk("a", 3), chunk("b", 1)];

      const results = await runToCompletion(harness, { requestKey: "key-results", chunks });

      expect(results.map((result) => result.chunkId)).toEqual(["a", "b"]);
      for (const [index, result] of results.entries()) {
        if (result.status !== "ok") throw new Error(`Chunk ${result.chunkId} failed unexpectedly`);
        const submitted = chunks[index];
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
      const { provider } = createHarness();
      const request = { requestKey: "key-replay", chunks: [chunk("a", 2)] };

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
      const { provider } = createHarness();
      const oversized = chunk("big", provider.limits.maxPages + 1);

      const failure = await provider
        .start({ requestKey: "key-oversized", chunks: [oversized] })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(IntegrationError);
      expect((failure as IntegrationError).kind).toBe("REJECTED");
    });

    it("submits nothing when the signal is already aborted", async () => {
      const { provider } = createHarness();
      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.start({ requestKey: "key-aborted", chunks: [chunk("a", 1)] }, { signal: controller.signal }),
      ).rejects.toThrow();
      expect(await provider.findOperation("key-aborted")).toBeNull();
    });

    it("cancels a pending operation", async (context) => {
      const { provider } = createHarness();
      const started = await provider.start({ requestKey: "key-cancel", chunks: [chunk("a", 1)] });
      if (started.status === "completed") return context.skip();

      await provider.cancel(started.operationRef);

      expect(await provider.poll(started.operationRef)).toEqual({ status: "cancelled" });
    });

    it("allows cleanup to be repeated", async (context) => {
      const { provider, settle } = createHarness();
      const started = await provider.start({ requestKey: "key-cleanup", chunks: [chunk("a", 1)] });
      if (started.status === "completed") return context.skip();
      await settle(started.operationRef);

      await provider.cleanup(started.operationRef);
      await expect(provider.cleanup(started.operationRef)).resolves.toBeUndefined();
    });
  });
}
