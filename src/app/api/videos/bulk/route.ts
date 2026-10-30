import { createVideosFromLessonsSchema } from "@/features/videos/schemas/video.schema";
import { createVideosFromLessons } from "@/features/videos/services/video.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One video per lesson, made together; a video that ties several lessons together is POST /api/videos.
export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await createVideosFromLessons(await readJson(request, createVideosFromLessonsSchema)), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
