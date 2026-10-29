import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IntegrationError } from "@/server/integrations/integration-error";
import { MistralClient } from "@/server/ocr/mistral/mistral-client";

import { FakeMistralServer } from "../../helpers/fake-mistral-server";

let server: FakeMistralServer;
let client: MistralClient;
let directory: string;

const KEY = "sk-test-secret-key";

beforeAll(async () => {
  server = await FakeMistralServer.start(KEY);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.files.clear();
  server.requests.length = 0;
  server.reportedBytes = null;
  server.normalizeBatchUploads = false;
  client = new MistralClient({ apiKey: KEY, baseUrl: server.baseUrl });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-mistral-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function writePdf(name: string, content = "%PDF-1.4 fake"): string {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function failureOf(promise: Promise<unknown>): Promise<IntegrationError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(IntegrationError);
  return error as IntegrationError;
}

describe("MistralClient file upload", () => {
  it("uploads a document with purpose ocr and returns the validated file id, without any public URL", async () => {
    const filePath = writePdf("chunk.pdf", "%PDF-1.4 nội dung");

    const file = await client.uploadFile({ filePath, fileName: "chunk-1.pdf", purpose: "ocr" });

    expect(file.id).toBe("file-1");
    const stored = server.files.get("file-1");
    expect(stored).toMatchObject({ filename: "chunk-1.pdf", purpose: "ocr" });
    expect(stored?.bytes.toString("utf8")).toBe("%PDF-1.4 nội dung");
    expect(server.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["POST /v1/files"]);
  });

  it("uploads a JSONL request file as text with purpose batch", async () => {
    const file = await client.uploadText({
      content: '{"custom_id":"a"}\n',
      fileName: "requests.jsonl",
      purpose: "batch",
    });

    expect(server.files.get(file.id)).toMatchObject({ purpose: "batch", filename: "requests.jsonl" });
  });

  it("sends the API key only as a bearer header", async () => {
    await client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" });

    expect(server.requests[0]?.authorization).toBe(`Bearer ${KEY}`);
  });

  it("accepts batch JSONL normalized with server defaults and a different stored size", async () => {
    server.normalizeBatchUploads = true;
    const content = '{"custom_id":"a","body":{"document":{"type":"file","file_id":"file-pdf"}}}\n';

    const file = await client.uploadText({ content, fileName: "requests.jsonl", purpose: "batch" });

    expect(file.bytes).toBeGreaterThan(Buffer.byteLength(content));
    expect(server.files.get(file.id)?.bytes.toString("utf8")).toContain('"extract_header":false');
  });

  it("rejects an OCR PDF response whose size differs from what was sent", async () => {
    server.reportedBytes = (file) => file.bytes.byteLength - 1;
    const filePath = writePdf("chunk.pdf");

    const failure = await failureOf(client.uploadFile({ filePath, fileName: "chunk.pdf", purpose: "ocr" }));

    expect(failure).toMatchObject({ code: "MISTRAL_UPLOAD_SIZE_MISMATCH", kind: "REJECTED" });
  });

  it("treats a malformed upload response as an unknown outcome, since the file may exist remotely", async () => {
    server.failNext("POST", /^\/v1\/files$/, { kind: "garbage" });

    const failure = await failureOf(client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }));

    expect(failure).toMatchObject({ code: "MISTRAL_BAD_RESPONSE", kind: "UNKNOWN_OUTCOME" });
  });

  it("treats a connection dropped during an upload as an unknown outcome", async () => {
    server.failNext("POST", /^\/v1\/files$/, { kind: "drop" });

    const failure = await failureOf(client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }));

    expect(failure).toMatchObject({ code: "MISTRAL_TRANSPORT", kind: "UNKNOWN_OUTCOME" });
  });

  it("treats a server error on an upload as an unknown outcome", async () => {
    server.failNext("POST", /^\/v1\/files$/, { kind: "status", status: 503 });

    const failure = await failureOf(client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }));

    expect(failure).toMatchObject({ code: "MISTRAL_HTTP_503", kind: "UNKNOWN_OUTCOME" });
  });

  it("maps authentication failures without echoing the key", async () => {
    const wrong = new MistralClient({ apiKey: "sk-wrong-key", baseUrl: server.baseUrl });

    const failure = await failureOf(wrong.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }));

    expect(failure).toMatchObject({ code: "MISTRAL_HTTP_401", kind: "AUTH" });
    expect(JSON.stringify([failure.message, failure.details])).not.toContain("sk-wrong-key");
  });

  it("maps a rate limit to QUOTA and keeps the retry hint", async () => {
    server.failNext("POST", /^\/v1\/files$/, { kind: "status", status: 429, headers: { "retry-after": "12" } });

    const failure = await failureOf(client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }));

    expect(failure).toMatchObject({ kind: "QUOTA", retryAfterMs: 12_000 });
  });

  it("maps another client error to REJECTED and carries Mistral's short message", async () => {
    server.failNext("POST", /^\/v1\/files$/, { kind: "status", status: 422, body: { message: "bad purpose" } });

    const failure = await failureOf(client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }));

    expect(failure).toMatchObject({ kind: "REJECTED" });
    expect(failure.message).toContain("bad purpose");
  });

  it("does not wrap a cancellation by the caller as an integration failure", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" }, controller.signal),
    ).rejects.not.toBeInstanceOf(IntegrationError);
    expect(server.files.size).toBe(0);
  });
});

describe("MistralClient file deletion and download", () => {
  it("deletes a file and validates the answer", async () => {
    const file = await client.uploadText({ content: "x", fileName: "a.jsonl", purpose: "batch" });

    await expect(client.deleteFile(file.id)).resolves.toEqual({ id: file.id, deleted: true });
    expect(server.files.size).toBe(0);
  });

  it("reports a missing file as REJECTED so a caller can treat it as already gone", async () => {
    const failure = await failureOf(client.deleteFile("file-missing"));

    expect(failure).toMatchObject({ code: "MISTRAL_HTTP_404", kind: "REJECTED" });
  });

  it("retries a read that failed with a server error as TRANSIENT", async () => {
    server.failNext("GET", /\/content$/, { kind: "status", status: 502 });

    const failure = await failureOf(client.downloadFileText("file-1"));

    expect(failure).toMatchObject({ kind: "TRANSIENT" });
  });

  it("downloads file content as text", async () => {
    const file = await client.uploadText({ content: "dòng 1\ndòng 2\n", fileName: "out.jsonl", purpose: "batch" });

    await expect(client.downloadFileText(file.id)).resolves.toBe("dòng 1\ndòng 2\n");
  });
});
