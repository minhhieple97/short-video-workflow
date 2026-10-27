import { createVideoSchema } from "@/features/videos/schemas/video.schema";
import { createVideo, listVideos } from "@/features/videos/services/video.service";
import { errorResponse, readJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const bookId = new URL(request.url).searchParams.get("bookId") ?? undefined;
    return Response.json({ videos: await listVideos({ bookId }) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await createVideo(await readJson(request, createVideoSchema)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
