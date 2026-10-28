import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IntegrationError } from "@/server/integrations/integration-error";
import { createOcrProvider } from "@/server/ocr";
import { MistralBatchOcrProvider } from "@/server/ocr/mistral/mistral-batch-ocr-provider";
import { MistralClient } from "@/server/ocr/mistral/mistral-client";
import type { OcrChunkResult, OcrInputChunk, OcrOperationStatus } from "@/server/ocr/ocr-provider";

import { describeOcrProviderContract } from "../../helpers/contracts/ocr-provider-contract";
import { FakeMistralServer, type CompleteJobOptions } from "../../helpers/fake-mistral-server";

let server: FakeMistralServer;
let provider: MistralBatchOcrProvider;
let directory: string;

beforeAll(async () => {
  server = await FakeMistralServer.start();
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.files.clear();
  server.jobs.clear();
  server.requests.length = 0;
  provider = new MistralBatchOcrProvider(new MistralClient({ apiKey: "test-key", baseUrl: server.baseUrl }), {
    model: "mistral-ocr-4-1",
    usdPer1000Pages: 2,
  });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-ocr-provider-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

// The fake server reads the page count back from this marker, standing in for a real PDF.
function makeChunk(chunkId: string, pageCount: number): OcrInputChunk {
  const filePath = path.join(directory, `${chunkId}.pdf`);
  fs.writeFileSync(filePath, `%PDF-1.4 pages=${pageCount}`);
  return { chunkId, filePath, pageCount, bytes: fs.statSync(filePath).size };
}

async function submitAndComplete(chunks: OcrInputChunk[], options?: CompleteJobOptions): Promise<string> {
  const started = await provider.start({ requestKey: `key-${Math.random()}`, chunks });
  if (started.status !== "submitted") throw new Error("Mistral batch must be submitted, not completed inline");
  server.completeJob(started.operationRef, options);
  return started.operationRef;
}

async function completedChunks(operationRef: string): Promise<OcrChunkResult[]> {
  const status = await provider.poll(operationRef);
  if (status.status !== "completed") throw new Error(`Expected completed, got ${status.status}`);
  return status.chunks;
}

describeOcrProviderContract("MistralBatchOcrProvider against the fake Mistral server", () => ({
  provider: new MistralBatchOcrProvider(new MistralClient({ apiKey: "test-key", baseUrl: server.baseUrl }), {
    model: "mistral-ocr-4-1",
    usdPer1000Pages: 2,
  }),
  settle: (operationRef) => server.completeJob(operationRef),
  makeChunk,
}));

describe("MistralBatchOcrProvider", () => {
  it("prices OCR from the configured batch rate", () => {
    expect(provider.estimateCostUsd(1_000)).toBe(2);
    expect(provider.estimateCostUsd(250)).toBeCloseTo(0.5);
    expect(provider.model).toBe("mistral-ocr-4-1");
  });

  it("reports pending without waiting while Mistral has not finished", async () => {
    const started = await provider.start({ requestKey: "k", chunks: [makeChunk("a", 1)] });
    if (started.status !== "submitted") throw new Error("expected submitted");

    const queued: OcrOperationStatus = await provider.poll(started.operationRef);
    server.setJobStatus(started.operationRef, "RUNNING");
    const running = await provider.poll(started.operationRef);

    expect(queued).toEqual({ status: "pending", retryAfterMs: 60_000 });
    expect(running).toEqual({ status: "pending", retryAfterMs: 60_000 });
  });

  it("returns page text with the confidence Mistral reported for each page", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 2)], { confidence: 0.91 });

    const [result] = await completedChunks(operationRef);

    expect(result).toEqual({
      chunkId: "a",
      status: "ok",
      pages: [
        { pageIndex: 0, markdown: "Trang 1 của a", confidence: 0.91 },
        { pageIndex: 1, markdown: "Trang 2 của a", confidence: 0.91 },
      ],
    });
  });

  it("leaves confidence null when Mistral reports none, instead of inventing one", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1)], { confidence: null });

    const [result] = await completedChunks(operationRef);

    expect(result).toMatchObject({ status: "ok", pages: [{ confidence: null }] });
  });

  it("accepts page indexes that start at 1 and still reports them 0-based", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 3)], { oneBasedPages: true });

    const [result] = await completedChunks(operationRef);

    expect(result?.status === "ok" && result.pages.map((page) => page.pageIndex)).toEqual([0, 1, 2]);
  });

  it("fails a chunk whose page indexes are not contiguous instead of guessing", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 2)]);
    const job = server.jobs.get(operationRef);
    const outputId = job?.output_file ?? "";
    const stored = server.files.get(outputId);
    if (!stored) throw new Error("fake output missing");
    const line = JSON.parse(stored.bytes.toString("utf8").trim()) as {
      response: { body: { pages: { index: number }[] } };
    };
    line.response.body.pages[1] = { ...line.response.body.pages[1], index: 5 } as { index: number };
    stored.bytes = Buffer.from(`${JSON.stringify(line)}\n`);

    const [result] = await completedChunks(operationRef);

    expect(result).toMatchObject({ chunkId: "a", status: "failed", code: "OCR_BAD_PAGE_INDEX" });
  });

  it("reports a partial success: failed chunks are marked failed while the others keep their text", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1), makeChunk("b", 1)], { failChunks: ["b"] });

    const results = await completedChunks(operationRef);

    expect(results.find((result) => result.chunkId === "a")).toMatchObject({ status: "ok" });
    expect(results.find((result) => result.chunkId === "b")).toMatchObject({
      status: "failed",
      code: "OCR_REQUEST_FAILED",
    });
  });

  it("omits a chunk Mistral returned nothing for, leaving the caller to notice the gap", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1), makeChunk("b", 1)], { omitChunks: ["b"] });

    expect((await completedChunks(operationRef)).map((result) => result.chunkId)).toEqual(["a"]);
  });

  it("marks a chunk reported twice as failed rather than choosing one silently", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1)]);
    const stored = server.files.get(server.jobs.get(operationRef)?.output_file ?? "");
    if (!stored) throw new Error("fake output missing");
    stored.bytes = Buffer.concat([stored.bytes, stored.bytes]);

    expect(await completedChunks(operationRef)).toMatchObject([
      { chunkId: "a", status: "failed", code: "OCR_DUPLICATE_RESULT" },
    ]);
  });

  it.each([
    ["FAILED", { code: "MISTRAL_BATCH_FAILED", retryable: false }],
    ["TIMEOUT_EXCEEDED", { code: "MISTRAL_BATCH_TIMEOUT", retryable: true }],
  ])("maps a %s batch to a failed operation", async (status, expected) => {
    const started = await provider.start({ requestKey: `k-${status}`, chunks: [makeChunk("a", 1)] });
    if (started.status !== "submitted") throw new Error("expected submitted");
    server.setJobStatus(started.operationRef, status);

    expect(await provider.poll(started.operationRef)).toMatchObject({ status: "failed", ...expected });
  });

  it("fails loudly on an output line it cannot parse, without quoting the content", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1)]);
    const stored = server.files.get(server.jobs.get(operationRef)?.output_file ?? "");
    if (!stored) throw new Error("fake output missing");
    stored.bytes = Buffer.from("NỘI DUNG SÁCH BÍ MẬT không phải JSON\n");

    const failure = await provider.poll(operationRef).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IntegrationError);
    expect(failure).toMatchObject({ code: "MISTRAL_BAD_RESPONSE", kind: "REJECTED", details: { lineNumber: 1 } });
    expect(
      JSON.stringify([(failure as IntegrationError).message, (failure as IntegrationError).details]),
    ).not.toContain("BÍ MẬT");
  });

  it("removes every uploaded file on cleanup, and a second cleanup is a no-op", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1), makeChunk("b", 1)], { failChunks: ["b"] });
    expect(server.files.size).toBeGreaterThan(0);

    await provider.cleanup(operationRef);
    expect(server.files.size).toBe(0);
    await expect(provider.cleanup(operationRef)).resolves.toBeUndefined();
  });

  it("finishes the cleanup on a retry when a delete failed half-way", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1), makeChunk("b", 1)]);
    const requestFile = server.files.get(server.jobs.get(operationRef)?.input_files[0] ?? "");
    const firstDocumentId = (
      JSON.parse((requestFile?.bytes.toString("utf8") ?? "").split("\n")[0] ?? "{}") as {
        body: { document: { file_id: string } };
      }
    ).body.document.file_id;
    server.failNext("DELETE", new RegExp(`^/v1/files/${firstDocumentId}$`), { kind: "status", status: 500 });

    await expect(provider.cleanup(operationRef)).rejects.toBeInstanceOf(IntegrationError);
    expect(server.files.size).toBeGreaterThan(0);

    await provider.cleanup(operationRef);
    expect(server.files.size).toBe(0);
  });

  it("treats cleanup of a job Mistral no longer knows as already done", async () => {
    await expect(provider.cleanup("job-never-existed")).resolves.toBeUndefined();
  });

  it("loses the output once cleaned up (which is why callers must store it first) and says so as expired", async () => {
    const operationRef = await submitAndComplete([makeChunk("a", 1)]);
    const chunks = await completedChunks(operationRef);
    expect(chunks).toHaveLength(1);

    await provider.cleanup(operationRef);

    await expect(provider.poll(operationRef)).resolves.toEqual({ status: "expired" });
  });
});

describe("createOcrProvider", () => {
  const settings = { apiKey: "key", baseUrl: "http://127.0.0.1:1", ocrModel: "mistral-ocr-4-1", usdPer1000Pages: 2 };

  it("refuses to build a provider without an API key", () => {
    expect(() => createOcrProvider({ ...settings, apiKey: undefined })).toThrowError(
      expect.objectContaining({ code: "OCR_NOT_CONFIGURED", kind: "REJECTED" }),
    );
  });

  it("builds the Mistral provider with the configured model and rate", () => {
    const built = createOcrProvider(settings);

    expect(built).toBeInstanceOf(MistralBatchOcrProvider);
    expect(built.model).toBe("mistral-ocr-4-1");
    expect(built.estimateCostUsd(500)).toBe(1);
  });
});
