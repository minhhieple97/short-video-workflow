import { z } from "zod";

import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";

import type { McpCallResult } from "./mcp-stdio-client";

const envelopeSchema = z.looseObject({ status: z.enum(["success", "error"]), error: z.string().optional() });

export type NotebookLmPayload = Record<string, unknown>;

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
  NOTEBOOKLM_TOOL_ERROR: "NotebookLM từ chối yêu cầu.",
  NOTEBOOKLM_BAD_RESPONSE: "Phản hồi của NotebookLM không đúng định dạng mong đợi.",
};

function failure(code: string, kind: IntegrationFailureKind, tool: string): IntegrationError {
  return new IntegrationError(code, MESSAGES[code] ?? MESSAGES.NOTEBOOKLM_TOOL_ERROR ?? code, kind, {
    details: { tool },
  });
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

  const text = envelope.data.error ?? "";
  const match = FAILURE_PATTERNS.find((candidate) => candidate.pattern.test(text));
  if (!match) return rejectUnknown(tool);
  const kind = match.kind === "TRANSIENT" && mutating ? "UNKNOWN_OUTCOME" : match.kind;
  throw failure(match.code, kind, tool);
}

function rejectUnknown(tool: string): never {
  throw failure("NOTEBOOKLM_TOOL_ERROR", "REJECTED", tool);
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
