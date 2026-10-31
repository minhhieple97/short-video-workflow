import { concurrencySettingsSchema } from "@/features/settings/schemas/concurrency-settings.schema";
import {
  getConcurrencySettingsOverview,
  updateConcurrencySettings,
} from "@/features/settings/services/concurrency-settings.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getConcurrencySettingsOverview());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    return Response.json(await updateConcurrencySettings(await readJson(request, concurrencySettingsSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}
