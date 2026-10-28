import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IntegrationError } from "@/server/integrations/integration-error";
import { MistralClient } from "@/server/ocr/mistral/mistral-client";
import {
  buildOcrBatchLine,
  findBatchJobByRequestKey,
  submitOcrBatch,
  REQUEST_KEY_METADATA,
} from "@/server/ocr/mistral/mistral-batch-submit";
import type { OcrInputChunk } from "@/server/ocr/ocr-provider";

import { FakeMistralServer } from "../../helpers/fake-mistral-server";

let server: FakeMistralServer;
let client: MistralClient;
let directory: string;

const MODEL = "mistral-ocr-4-1";

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
  client = new MistralClient({ apiKey: "test-key", baseUrl: server.baseUrl });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-submit-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function chunk(chunkId: string, pageCount = 2): OcrInputChunk {
  const filePath = path.join(directory, `${chunkId}.pdf`);
  fs.writeFileSync(filePath, `%PDF-1.4 ${chunkId}`);
  return { chunkId, filePath, pageCount, bytes: fs.statSync(filePath).size };
}

const countOf = (method: string, route: string) =>
  server.requests.filter((request) => request.method === method && request.path === route).length;

describe("submitOcrBatch", () => {
  it("uploads every chunk by file id, then one JSONL request file, then creates one job", async () => {
    const jobId = await submitOcrBatch(
      client,
      { requestKey: "ext-1:set-1", chunks: [chunk("c1"), chunk("c2")] },
      { model: MODEL },
    );

    const files = [...server.files.values()];
    expect(files.filter((file) => file.purpose === "ocr").map((file) => file.filename)).toEqual(["c1.pdf", "c2.pdf"]);
    const requestFile = files.find((file) => file.purpose === "batch");
    expect(requestFile?.filename).toBe("ocr-requests.jsonl");

    const lines = (requestFile?.bytes.toString("utf8") ?? "")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([buildOcrBatchLine("c1", "file-1"), buildOcrBatchLine("c2", "file-2")]);
    expect(JSON.stringify(lines)).not.toMatch(/https?:/);

    const job = server.jobs.get(jobId);
    expect(job).toMatchObject({
      endpoint: "/v1/ocr",
      model: MODEL,
      input_files: [requestFile?.id],
      metadata: { [REQUEST_KEY_METADATA]: "ext-1:set-1" },
      total_requests: 2,
    });
    expect(server.jobs.size).toBe(1);
  });

  it("identifies each OCR request by its chunk id so results can be matched back", () => {
    expect(buildOcrBatchLine("chunk-7", "file-9")).toEqual({
      custom_id: "chunk-7",
      body: expect.objectContaining({ document: { type: "file", file_id: "file-9" }, include_image_base64: false }),
    });
  });

  it("reuses the existing job on a replay and uploads and creates nothing", async () => {
    const request = { requestKey: "ext-1:set-1", chunks: [chunk("c1")] };
    const first = await submitOcrBatch(client, request, { model: MODEL });
    const uploadsAfterFirst = countOf("POST", "/v1/files");

    const replay = await submitOcrBatch(client, request, { model: MODEL });

    expect(replay).toBe(first);
    expect(countOf("POST", "/v1/files")).toBe(uploadsAfterFirst);
    expect(countOf("POST", "/v1/batch/jobs")).toBe(1);
  });

  it("does not submit again after a lost answer: the job is found by its request key instead", async () => {
    const request = { requestKey: "ext-1:set-1", chunks: [chunk("c1")] };
    server.failNext("POST", /^\/v1\/batch\/jobs$/, { kind: "drop-after" });

    const lost = await submitOcrBatch(client, request, { model: MODEL }).catch((error: unknown) => error);

    expect(lost).toBeInstanceOf(IntegrationError);
    expect(lost).toMatchObject({ kind: "UNKNOWN_OUTCOME" });
    expect(server.jobs.size).toBe(1);
    expect(server.files.size).toBe(2);

    const found = await findBatchJobByRequestKey(client, request.requestKey);
    const replay = await submitOcrBatch(client, request, { model: MODEL });

    const [createdJobId] = [...server.jobs.keys()];
    expect(found?.id).toBe(createdJobId);
    expect(replay).toBe(createdJobId);
    expect(server.jobs.size).toBe(1);
    expect(countOf("POST", "/v1/files")).toBe(2);
  });

  it("deletes what it uploaded when the job is refused outright", async () => {
    server.failNext("POST", /^\/v1\/batch\/jobs$/, { kind: "status", status: 422, body: { message: "bad model" } });

    await expect(
      submitOcrBatch(client, { requestKey: "ext-1:set-1", chunks: [chunk("c1")] }, { model: MODEL }),
    ).rejects.toMatchObject({ kind: "REJECTED" });

    expect(server.files.size).toBe(0);
    expect(server.jobs.size).toBe(0);
  });

  it("deletes the files it already uploaded when a later upload fails", async () => {
    server.failNext("POST", /^\/v1\/files$/, { kind: "status", status: 422 });
    const chunks = [chunk("c1"), chunk("c2")];
    server.files.clear();

    await expect(
      submitOcrBatch(client, { requestKey: "ext-1:set-1", chunks }, { model: MODEL }),
    ).rejects.toBeInstanceOf(IntegrationError);

    expect(server.files.size).toBe(0);
  });

  it("refuses an oversized chunk before uploading anything", async () => {
    await expect(
      submitOcrBatch(client, { requestKey: "ext-1:set-1", chunks: [chunk("big", 51)] }, { model: MODEL }),
    ).rejects.toMatchObject({ code: "OCR_CHUNK_TOO_LARGE", kind: "REJECTED" });

    expect(server.requests).toHaveLength(0);
  });

  it("refuses two chunks sharing an id, since results are matched back by it", async () => {
    await expect(
      submitOcrBatch(client, { requestKey: "ext-1:set-1", chunks: [chunk("a"), chunk("a")] }, { model: MODEL }),
    ).rejects.toMatchObject({ code: "OCR_DUPLICATE_CHUNK_ID" });
  });

  it("touches nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      submitOcrBatch(
        client,
        { requestKey: "ext-1:set-1", chunks: [chunk("c1")] },
        { model: MODEL, signal: controller.signal },
      ),
    ).rejects.toThrow();

    expect(server.requests).toHaveLength(0);
  });
});

describe("findBatchJobByRequestKey", () => {
  const seedJobs = (count: number) => {
    for (let index = 1; index <= count; index += 1) {
      server.jobs.set(`seed-${index}`, {
        id: `seed-${index}`,
        status: "SUCCESS",
        endpoint: "/v1/ocr",
        model: MODEL,
        input_files: [],
        metadata: { [REQUEST_KEY_METADATA]: `key-${index}` },
        output_file: null,
        error_file: null,
        total_requests: 1,
        succeeded_requests: 1,
        failed_requests: 0,
        createdOrder: index,
      });
    }
  };

  it("finds a job that is past the first page of results", async () => {
    seedJobs(150);

    expect((await findBatchJobByRequestKey(client, "key-3"))?.id).toBe("seed-3");
  });

  it("returns null when no job carries the key", async () => {
    seedJobs(3);

    expect(await findBatchJobByRequestKey(client, "key-unknown")).toBeNull();
  });
});
