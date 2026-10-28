import { driveCallbackQuerySchema } from "@/features/drive/schemas/drive-callback.schema";
import { completeDriveConnection } from "@/features/drive/services/drive-connection.service";
import { AppError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("drive.callback");

// The browser lands here after Google; it always goes on to Settings, which shows the result.
export async function GET(request: Request): Promise<Response> {
  const settings = new URL("/settings", request.url);
  try {
    const query = driveCallbackQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    await completeDriveConnection(query.success ? query.data : {});
    settings.searchParams.set("drive", "connected");
  } catch (error) {
    if (!(error instanceof AppError)) logger.error("Drive callback failed", { error: toSafeErrorMessage(error) });
    settings.searchParams.set("drive_error", error instanceof AppError ? error.code : "INTERNAL_ERROR");
  }
  return Response.redirect(settings, 303);
}
