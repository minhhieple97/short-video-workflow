import { AppError } from "@/shared/errors";

// AUTH and REJECTED fail again on retry; QUOTA and TRANSIENT may succeed after waiting;
// UNKNOWN_OUTCOME means the remote side may already have acted, so callers must reconcile before sending again.
export type IntegrationFailureKind = "AUTH" | "QUOTA" | "TRANSIENT" | "REJECTED" | "UNKNOWN_OUTCOME";

const HTTP_STATUS: Record<IntegrationFailureKind, number> = {
  AUTH: 502,
  QUOTA: 429,
  TRANSIENT: 503,
  REJECTED: 502,
  UNKNOWN_OUTCOME: 502,
};

export class IntegrationError extends AppError {
  readonly kind: IntegrationFailureKind;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: string,
    message: string,
    kind: IntegrationFailureKind,
    options?: ErrorOptions & { details?: Record<string, unknown>; retryAfterMs?: number },
  ) {
    super(code, message, HTTP_STATUS[kind], options);
    this.name = "IntegrationError";
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs;
  }
}
