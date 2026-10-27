import "server-only";

import type { z } from "zod";

import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("http");

export interface RouteContext<TParams extends Record<string, string>> {
  params: Promise<TParams>;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.httpStatus },
    );
  }
  logger.error("Unhandled route error", { error: toSafeErrorMessage(error) });
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Đã xảy ra lỗi không mong muốn." } },
    { status: 500 },
  );
}

export function parseInput<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  throw new AppError("VALIDATION_ERROR", issues[0]?.message ?? "Dữ liệu không hợp lệ.", 400, { details: { issues } });
}

export async function readJson<TSchema extends z.ZodType>(request: Request, schema: TSchema): Promise<z.output<TSchema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "Dữ liệu gửi lên không phải JSON hợp lệ.", 400);
  }
  return parseInput(schema, body);
}

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export function assertContentLengthWithin(request: Request, maxBytes: number): void {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "Dữ liệu tải lên vượt quá giới hạn cho phép.", 413);
  }
}
