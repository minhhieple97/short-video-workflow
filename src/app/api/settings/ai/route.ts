import { updateAiSettingsSchema } from "@/features/settings/schemas/ai-settings.schema";
import { getAiSettings, updateAiSettings } from "@/features/settings/services/ai-settings.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getAiSettings());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    return Response.json(await updateAiSettings(await readJson(request, updateAiSettingsSchema)));
  } catch (error) {
    return errorResponse(error);
  }
}
