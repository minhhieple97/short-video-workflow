import { detachSceneAudio, uploadSceneAudio } from "@/features/videos/services/audio.service";
import { assertContentLengthWithin, errorResponse, type RouteContext } from "@/server/http/route-helpers";
import { getAppConfig } from "@/shared/config/env";
import { AppError } from "@/shared/errors";

export const runtime = "nodejs";

type Context = RouteContext<{ sceneId: string }>;

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { sceneId } = await context.params;
    assertContentLengthWithin(request, getAppConfig().tts.maxUploadBytes);
    const form = await request.formData().catch(() => {
      throw new AppError("INVALID_FORM", "Dữ liệu tải lên không hợp lệ.", 400);
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "Hãy chọn một tệp MP3 hoặc WAV.", 400);
    await uploadSceneAudio(sceneId, {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { sceneId } = await context.params;
    await detachSceneAudio(sceneId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
