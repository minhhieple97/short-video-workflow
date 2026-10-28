import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";

export interface GoogleEndpoints {
  tokenUrl: string;
  revokeUrl: string;
  driveApiUrl: string;
  driveUploadUrl: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  driveApiUrl: "https://www.googleapis.com/drive/v3",
  driveUploadUrl: "https://www.googleapis.com/upload/drive/v3",
};

// Google itself, or a local fake of it serving the same paths under one base URL (tests only).
export function googleEndpoints(apiBaseUrl: string | undefined): GoogleEndpoints {
  if (!apiBaseUrl) return GOOGLE_ENDPOINTS;
  return {
    tokenUrl: `${apiBaseUrl}/token`,
    revokeUrl: `${apiBaseUrl}/revoke`,
    driveApiUrl: `${apiBaseUrl}/drive/v3`,
    driveUploadUrl: `${apiBaseUrl}/upload/drive/v3`,
  };
}

export const GOOGLE_READ_TIMEOUT_MS = 30_000;

export interface GoogleRequest<TResult> {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: BodyInit;
  // A mutating call that loses its response may still have taken effect on Google's side.
  mutating: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
  // Non-2xx statuses that are answers rather than failures, such as 308 "Resume Incomplete" during an upload.
  acceptStatuses?: readonly number[];
  parse: (response: Response) => Promise<TResult>;
}

const MESSAGES: Record<IntegrationFailureKind, string> = {
  AUTH: "Google từ chối quyền truy cập. Hãy kết nối lại Google Drive.",
  QUOTA: "Google báo vượt giới hạn. Sẽ thử lại sau.",
  TRANSIENT: "Google tạm thời không phản hồi. Sẽ thử lại sau.",
  REJECTED: "Google từ chối yêu cầu.",
  UNKNOWN_OUTCOME: "Google không trả lời rõ ràng; chưa biết thao tác đã được thực hiện hay chưa.",
};

const SPECIFIC_MESSAGES: Record<string, string> = {
  invalid_client:
    "Google không nhận OAuth client này. Hãy kiểm tra GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET.",
  unauthorized_client:
    "Google không nhận OAuth client này. Hãy kiểm tra GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET.",
  invalid_grant: "Quyền truy cập Google Drive không còn hiệu lực. Hãy kết nối lại.",
  storageQuotaExceeded: "Google Drive đã hết dung lượng lưu trữ. Hãy giải phóng dung lượng hoặc nâng gói rồi thử lại.",
};

const OAUTH_AUTH_ERRORS = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);
// Request-rate limits pass with time; a full Drive does not, and it is not a permission problem either.
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "sharingRateLimitExceeded",
]);
const STORAGE_FULL_REASON = "storageQuotaExceeded";

// OAuth errors are {"error": "invalid_grant", ...}; Drive errors are {"error": {"errors": [{"reason": "..."}]}}. Only a
// short identifier is kept: the rest of the body is never copied into an error, a log line or the UI.
async function readErrorReason(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const { error } = body;
  let reason: unknown = error;
  if (typeof error === "object" && error !== null && "errors" in error && Array.isArray(error.errors)) {
    const first: unknown = error.errors[0];
    reason = typeof first === "object" && first !== null && "reason" in first ? first.reason : null;
  }
  return typeof reason === "string" && /^[A-Za-z_]{1,64}$/.test(reason) ? reason : null;
}

export function classifyGoogleFailure(
  status: number,
  reason: string | null,
  mutating: boolean,
): IntegrationFailureKind {
  if (reason && OAUTH_AUTH_ERRORS.has(reason)) return "AUTH";
  if (reason === STORAGE_FULL_REASON) return "REJECTED";
  if (status === 429 || (status === 403 && reason !== null && RATE_LIMIT_REASONS.has(reason))) return "QUOTA";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 408 || status >= 500) return mutating ? "UNKNOWN_OUTCOME" : "TRANSIENT";
  return "REJECTED";
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : undefined;
}

export async function sendGoogleRequest<TResult>(request: GoogleRequest<TResult>): Promise<TResult> {
  request.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      // A 308 from the upload endpoint is "keep sending", never a redirect to follow.
      redirect: "manual",
      signal,
    });
  } catch (error) {
    // The caller cancelled: that is not an integration failure, so the abort passes through untouched.
    if (request.signal?.aborted) throw error;
    const kind = request.mutating ? "UNKNOWN_OUTCOME" : "TRANSIENT";
    throw new IntegrationError("GOOGLE_TRANSPORT", MESSAGES[kind], kind, { cause: error });
  }

  if (!response.ok && !request.acceptStatuses?.includes(response.status)) {
    const reason = await readErrorReason(response);
    const kind = classifyGoogleFailure(response.status, reason, request.mutating);
    throw new IntegrationError(
      reason ? `GOOGLE_${reason.toUpperCase()}` : `GOOGLE_HTTP_${response.status}`,
      (reason && SPECIFIC_MESSAGES[reason]) ?? MESSAGES[kind],
      kind,
      { details: { status: response.status, reason }, retryAfterMs: retryAfterMs(response) },
    );
  }

  try {
    return await request.parse(response);
  } catch (error) {
    const kind = request.mutating ? "UNKNOWN_OUTCOME" : "REJECTED";
    throw new IntegrationError("GOOGLE_BAD_RESPONSE", "Phản hồi của Google không đúng định dạng mong đợi.", kind, {
      cause: error,
    });
  }
}
