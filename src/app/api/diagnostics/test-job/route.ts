import { diagnosticRequestSchema } from "@/features/jobs/schemas/job-payload.schema";
import { enqueueDiagnosticPingJob } from "@/features/jobs/services/job-service";
import { errorResponse, readOptionalJson } from "@/server/http/route-helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const { kind } = await readOptionalJson(request, diagnosticRequestSchema);
    const job = await enqueueDiagnosticPingJob(kind);
    return Response.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
