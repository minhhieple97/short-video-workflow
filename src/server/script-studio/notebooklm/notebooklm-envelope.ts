import { z } from "zod";

import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";

import type { McpCallResult } from "./mcp-stdio-client";

// "success" and "error" are the usual statuses; refresh_auth also answers "expired" for a login that must be renewed. A
// failed query also carries `error_details`, the server's own classification of it.
const envelopeSchema = z.looseObject({
  status: z.string().min(1),
  error: z.string().optional(),
  error_details: z
    .looseObject({ category: z.string().optional(), retryable: z.boolean().optional() })
    .optional()
    .catch(undefined),
});

export type NotebookLmPayload = Record<string, unknown>;

// What the server says a failed query is: a fixed vocabulary of notebooklm-mcp-cli, never account text, and more exact than
// reading its message. `invalid_argument` is what a question over the word limit (notebooklm-query-limit.ts) comes back as.
const CATEGORY_FAILURES: Readonly<Record<string, { kind: IntegrationFailureKind; code: string }>> = {
  unauthenticated: { kind: "AUTH", code: "NOTEBOOKLM_AUTH_REQUIRED" },
  resource_exhausted: { kind: "QUOTA", code: "NOTEBOOKLM_QUOTA" },
  deadline_exceeded: { kind: "TRANSIENT", code: "NOTEBOOKLM_TIMEOUT" },
  internal: { kind: "TRANSIENT", code: "NOTEBOOKLM_UNAVAILABLE" },
  unavailable: { kind: "TRANSIENT", code: "NOTEBOOKLM_UNAVAILABLE" },
  invalid_argument: { kind: "REJECTED", code: "NOTEBOOKLM_INVALID_REQUEST" },
  not_found: { kind: "REJECTED", code: "NOTEBOOKLM_NOT_FOUND" },
  permission_denied: { kind: "REJECTED", code: "NOTEBOOKLM_PERMISSION_DENIED" },
};

// What a failure's own text says it is. The text is only matched, never shown: it can carry account details.
const FAILURE_PATTERNS: readonly { kind: IntegrationFailureKind; code: string; pattern: RegExp }[] = [
  {
    kind: "AUTH",
    code: "NOTEBOOKLM_AUTH_REQUIRED",
    pattern:
      /no authentication|not authenticated|authentication (?:failed|expired|required)|nlm login|cookies? (?:expired|invalid)|sign in again|session expired|unauthori[sz]ed/i,
  },
  {
    kind: "QUOTA",
    code: "NOTEBOOKLM_QUOTA",
    pattern: /rate.?limit|quota|usage limit|too many requests|\b429\b|limit reached/i,
  },
  { kind: "TRANSIENT", code: "NOTEBOOKLM_TIMEOUT", pattern: /time(?:d)? ?out|deadline exceeded/i },
];

const MESSAGES: Record<string, string> = {
  NOTEBOOKLM_AUTH_REQUIRED:
    "NotebookLM cần đăng nhập lại cho profile đã cấu hình. Hãy chạy `nlm login --profile <tên>` trong terminal của bạn.",
  NOTEBOOKLM_QUOTA: "NotebookLM báo đã chạm giới hạn sử dụng; sẽ thử lại sau.",
  NOTEBOOKLM_TIMEOUT: "NotebookLM không trả lời kịp; sẽ thử lại sau.",
  NOTEBOOKLM_UNAVAILABLE: "NotebookLM đang tạm lỗi; sẽ thử lại sau.",
  NOTEBOOKLM_INVALID_REQUEST:
    "NotebookLM báo yêu cầu không hợp lệ (thường do câu hỏi dài quá giới hạn của NotebookLM hoặc nguồn không dùng được).",
  NOTEBOOKLM_NOT_FOUND: "NotebookLM không thấy notebook hoặc nguồn cần dùng (có thể đã bị xoá).",
  NOTEBOOKLM_PERMISSION_DENIED: "Tài khoản NotebookLM không có quyền dùng notebook hoặc nguồn này.",
  NOTEBOOKLM_TOOL_ERROR: "NotebookLM từ chối yêu cầu.",
  NOTEBOOKLM_BAD_RESPONSE: "Phản hồi của NotebookLM không đúng định dạng mong đợi.",
};

function failure(code: string, kind: IntegrationFailureKind, tool: string, category?: string): IntegrationError {
  const wording = MESSAGES[code] ?? MESSAGES.NOTEBOOKLM_TOOL_ERROR ?? code;
  // The generic refusal at least says what the server called the failure.
  const message = code === "NOTEBOOKLM_TOOL_ERROR" && category ? wording.replace(/\.$/, ` (${category}).`) : wording;
  return new IntegrationError(code, message, kind, { details: category ? { tool, category } : { tool } });
}

// A tool answers {"status": "success", ...} or {"status": "error", "error": "..."}, and reports its errors with
// isError false, so the call's own success flag proves nothing. Only an explicit success counts. For a tool that changes
// something, a timeout means the change may have happened, so it is UNKNOWN_OUTCOME and the caller must look before
// asking again.
export function readNotebookLmEnvelope(tool: string, result: McpCallResult, mutating: boolean): NotebookLmPayload {
  const envelope = envelopeSchema.safeParse(result.structuredContent ?? parseTextContent(result));
  if (!envelope.success) {
    throw failure("NOTEBOOKLM_BAD_RESPONSE", mutating ? "UNKNOWN_OUTCOME" : "REJECTED", tool);
  }
  if (envelope.data.status === "success" && !result.isError) return envelope.data;

  if (envelope.data.status === "expired") throw failure("NOTEBOOKLM_AUTH_REQUIRED", "AUTH", tool);
  const text = envelope.data.error ?? "";
  const { category, retryable } = envelope.data.error_details ?? {};
  const match =
    (category ? CATEGORY_FAILURES[category] : undefined) ??
    FAILURE_PATTERNS.find((candidate) => candidate.pattern.test(text)) ??
    (retryable ? { kind: "TRANSIENT" as const, code: "NOTEBOOKLM_UNAVAILABLE" } : undefined);
  if (!match) throw failure("NOTEBOOKLM_TOOL_ERROR", "REJECTED", tool, category);
  const kind = match.kind === "TRANSIENT" && mutating ? "UNKNOWN_OUTCOME" : match.kind;
  throw failure(match.code, kind, tool, category);
}

function parseTextContent(result: McpCallResult): unknown {
  const first = result.content[0];
  if (typeof first !== "object" || first === null || !("text" in first) || typeof first.text !== "string") return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return null;
  }
}
