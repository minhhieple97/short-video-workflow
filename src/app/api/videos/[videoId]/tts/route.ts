import { z } from "zod";

import { requestAllTts, requestMissingTts } from "@/features/videos/services/audio-request.service";
import { errorResponse, readOptionalJson, type RouteContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";

// "missing" voices the scenes without a clip; "all" voices every scene again at the video's pace.
const requestSchema = z.object({ scope: z.enum(["missing", "all"]).default("missing") });

export async function POST(request: Request, context: RouteContext<{ videoId: string }>): Promise<Response> {
  try {
    const { videoId } = await context.params;
    const { scope } = await readOptionalJson(request, requestSchema);
    const jobs = scope === "all" ? await requestAllTts(videoId) : await requestMissingTts(videoId);
    return Response.json({ jobs: jobs.map((job) => ({ jobId: job.id, status: job.status })) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
