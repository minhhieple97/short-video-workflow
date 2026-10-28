import { randomUUID } from "node:crypto";

import { recordJobIntent } from "@/features/jobs/services/job-dispatch.service";
import { preflightFor } from "@/features/videos/services/render.service";
import { captureRenderSnapshot } from "@/features/videos/services/render-snapshot.service";
import {
  attachRenderJob,
  createRenderRecord,
  failRenderRecord,
  findActiveRender,
  findCompletedRender,
} from "@/features/videos/repositories/render.repository";
import { AppError } from "@/shared/errors";

// Queues the FINAL render of a production's video from the worker. The web's requestRender is for people: it refuses a
// video that a production owns, and it needs the web-only queue producer. This one records the job in the outbox, which
// the worker's sweep delivers, and it reuses a render that already exists for exactly this script version.
export async function queueFinalRender(videoId: string): Promise<{ renderId: string; reused: boolean }> {
  const { snapshot, hash, video } = await captureRenderSnapshot(videoId, "FINAL");

  const completed = await findCompletedRender(videoId, "FINAL", snapshot.video.scriptVersion);
  if (completed) return { renderId: completed.id, reused: true };
  const active = await findActiveRender(videoId, "FINAL");
  if (active) return { renderId: active.id, reused: true };

  const report = preflightFor(video, "FINAL");
  if (report.blocking.length > 0) {
    throw new AppError("PREFLIGHT_FAILED", `Chưa thể render: ${report.blocking[0]?.message ?? ""}`, 409, {
      details: { issues: report.blocking },
    });
  }

  const renderId = randomUUID();
  await createRenderRecord({
    id: renderId,
    videoId,
    scriptVersion: snapshot.video.scriptVersion,
    outputPath: `videos/${videoId}/renders/${renderId}-final.mp4`,
    qualityPreset: "FINAL",
    width: snapshot.render.width,
    height: snapshot.render.height,
    fps: snapshot.render.fps,
    snapshotJson: snapshot,
    snapshotHash: hash,
  });
  try {
    const intent = await recordJobIntent({
      jobType: "RENDER_VIDEO",
      entityType: "RENDER",
      entityId: renderId,
      payload: { renderId },
    });
    await attachRenderJob(renderId, intent.jobRecordId);
  } catch (error) {
    await failRenderRecord(renderId, "FAILED", "Không thể ghi yêu cầu render vào hàng đợi.");
    throw error;
  }
  return { renderId, reused: false };
}
