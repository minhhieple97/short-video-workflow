import "server-only";

import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

const logger = createLogger("http");

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
  }
  logger.error("Unhandled route error", { error: toSafeErrorMessage(error) });
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Đã xảy ra lỗi không mong muốn." } },
    { status: 500 },
  );
}
