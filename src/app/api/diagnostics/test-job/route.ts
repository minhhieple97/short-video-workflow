import { enqueueDiagnosticPingJob } from "@/features/jobs/services/job-service";
import { errorResponse } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    const job = await enqueueDiagnosticPingJob();
    return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
