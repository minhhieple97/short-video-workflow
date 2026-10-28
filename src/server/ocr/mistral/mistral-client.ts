import { openAsBlob } from "node:fs";

import type { z } from "zod";

import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";

import {
  mistralDeletedFileSchema,
  mistralFileSchema,
  type MistralDeletedFile,
  type MistralFile,
} from "./mistral-schemas";

const READ_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const ERROR_MESSAGE_LIMIT = 200;

export interface MistralClientOptions {
  apiKey: string;
  baseUrl: string;
}

interface SendOptions<TResult> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  // A mutating call that loses its response may still have taken effect on Mistral's side.
  mutating: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  parse: (response: Response) => Promise<TResult>;
}

function parseJson<TSchema extends z.ZodType>(schema: TSchema): (response: Response) => Promise<z.output<TSchema>> {
  return async (response) => schema.parse(await response.json());
}

const parseText = (response: Response): Promise<string> => response.text();

function failureKindForStatus(status: number, mutating: boolean): IntegrationFailureKind {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "QUOTA";
  if (status === 408 || status >= 500) return mutating ? "UNKNOWN_OUTCOME" : "TRANSIENT";
  return "REJECTED";
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : undefined;
}

// Mistral's error body is {"message": "..."}; anything else is ignored so nothing unexpected reaches logs or the UI.
async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
      return body.message.slice(0, ERROR_MESSAGE_LIMIT);
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return null;
}

const MESSAGES: Record<IntegrationFailureKind, string> = {
  AUTH: "Mistral từ chối khóa API. Hãy kiểm tra MISTRAL_API_KEY.",
  QUOTA: "Mistral báo vượt giới hạn hoặc hết hạn mức. Hãy chờ rồi thử lại.",
  TRANSIENT: "Mistral tạm thời không phản hồi. Sẽ thử lại sau.",
  REJECTED: "Mistral từ chối yêu cầu.",
  UNKNOWN_OUTCOME: "Mistral không trả lời rõ ràng; chưa biết thao tác đã được thực hiện hay chưa.",
};

// Speaks Mistral's REST API with typed, validated responses. The API key lives only in this object and is never
// copied into an error, a log line or a persisted value.
export class MistralClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: MistralClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
  }

  // Sent as `purpose` "ocr" for documents and "batch" for JSONL request files. No public URL is ever needed: callers
  // refer to the returned file id.
  async uploadFile(
    input: { filePath: string; fileName: string; purpose: "ocr" | "batch" },
    signal?: AbortSignal,
  ): Promise<MistralFile> {
    return this.uploadBlob(await openAsBlob(input.filePath), input.fileName, input.purpose, signal);
  }

  uploadText(
    input: { content: string; fileName: string; purpose: "ocr" | "batch" },
    signal?: AbortSignal,
  ): Promise<MistralFile> {
    return this.uploadBlob(new Blob([input.content]), input.fileName, input.purpose, signal);
  }

  deleteFile(fileId: string, signal?: AbortSignal): Promise<MistralDeletedFile> {
    return this.send({
      method: "DELETE",
      path: `/v1/files/${encodeURIComponent(fileId)}`,
      mutating: false,
      timeoutMs: READ_TIMEOUT_MS,
      signal,
      parse: parseJson(mistralDeletedFileSchema),
    });
  }

  downloadFileText(fileId: string, signal?: AbortSignal): Promise<string> {
    return this.send({
      method: "GET",
      path: `/v1/files/${encodeURIComponent(fileId)}/content`,
      mutating: false,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      signal,
      parse: parseText,
    });
  }

  private async uploadBlob(
    blob: Blob,
    fileName: string,
    purpose: "ocr" | "batch",
    signal?: AbortSignal,
  ): Promise<MistralFile> {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", blob, fileName);

    const file = await this.send({
      method: "POST",
      path: "/v1/files",
      body: form,
      mutating: true,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      signal,
      parse: parseJson(mistralFileSchema),
    });
    if (typeof file.purpose === "string" && file.purpose !== purpose) {
      throw new IntegrationError("MISTRAL_BAD_RESPONSE", "Mistral lưu tệp với mục đích khác với yêu cầu.", "REJECTED");
    }
    if (typeof file.bytes === "number" && file.bytes !== blob.size) {
      throw new IntegrationError(
        "MISTRAL_UPLOAD_SIZE_MISMATCH",
        "Mistral báo kích thước tệp khác với tệp đã gửi, có thể upload bị cắt.",
        "REJECTED",
        { details: { sent: blob.size, stored: file.bytes } },
      );
    }
    return file;
  }

  private async send<TResult>(options: SendOptions<TResult>): Promise<TResult> {
    // Also avoids an undici bug: fetch() with a FormData body and an already-aborted signal leaves an unhandled
    // rejection that would crash the worker process.
    options.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers: { authorization: `Bearer ${this.apiKey}`, ...options.headers },
        body: options.body,
        signal,
      });
    } catch (error) {
      // The caller cancelled: that is not an integration failure, so the abort passes through untouched.
      if (options.signal?.aborted) throw error;
      const kind = options.mutating ? "UNKNOWN_OUTCOME" : "TRANSIENT";
      throw new IntegrationError("MISTRAL_TRANSPORT", MESSAGES[kind], kind, { cause: error });
    }

    if (!response.ok) {
      const kind = failureKindForStatus(response.status, options.mutating);
      const detail = await readErrorMessage(response);
      throw new IntegrationError(
        `MISTRAL_HTTP_${response.status}`,
        detail ? `${MESSAGES[kind]} (${detail})` : MESSAGES[kind],
        kind,
        { details: { status: response.status }, retryAfterMs: retryAfterMs(response) },
      );
    }

    try {
      return await options.parse(response);
    } catch (error) {
      const kind = options.mutating ? "UNKNOWN_OUTCOME" : "REJECTED";
      throw new IntegrationError("MISTRAL_BAD_RESPONSE", "Phản hồi của Mistral không đúng định dạng mong đợi.", kind, {
        cause: error,
      });
    }
  }
}
