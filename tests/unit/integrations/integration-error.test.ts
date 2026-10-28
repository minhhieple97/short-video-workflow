import { describe, expect, it } from "vitest";

import { IntegrationError, type IntegrationFailureKind } from "@/server/integrations/integration-error";
import { AppError } from "@/shared/errors";

describe("IntegrationError", () => {
  it("is an AppError that keeps its stable code, kind and retry hint", () => {
    const error = new IntegrationError("OCR_QUOTA", "Hết hạn mức.", "QUOTA", {
      retryAfterMs: 30_000,
      details: { page: 3 },
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("OCR_QUOTA");
    expect(error.kind).toBe("QUOTA");
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.details).toEqual({ page: 3 });
  });

  it.each<[IntegrationFailureKind, number]>([
    ["AUTH", 502],
    ["QUOTA", 429],
    ["TRANSIENT", 503],
    ["REJECTED", 502],
    ["UNKNOWN_OUTCOME", 502],
  ])("maps %s to HTTP %i", (kind, status) => {
    expect(new IntegrationError("X", "x", kind).httpStatus).toBe(status);
  });
});
