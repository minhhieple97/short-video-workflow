import "server-only";

import { randomUUID } from "node:crypto";

import { enqueueTrackedJob } from "@/features/jobs/services/job-service";
import { AppError } from "@/shared/errors";

import type { RenderQuality } from "../domain/preflight";
import {
  attachRenderJob,
  createRenderRecord,
  failRenderRecord,
  findActiveRender,
} from "../repositories/render.repository";
import { preflightFor } from "./render.service";
import { captureRenderSnapshot } from "./render-snapshot.service";
import { assertScriptNotGenerating } from "./video.service";

export async function requestRender(
  videoId: string,
  quality: RenderQuality,
): Promise<{ renderId: string; jobId: string }> {
  await assertScriptNotGenerating(videoId);
  const { snapshot, hash, video } = await captureRenderSnapshot(videoId, quality);
  const report = preflightFor(video, quality);
  if (report.blocking.length > 0) {
    throw new AppError("PREFLIGHT_FAILED", `Chưa thể render: ${report.blocking[0]?.message ?? ""}`, 409, {
      details: { issues: report.blocking },
    });
  }

  const active = await findActiveRender(videoId, quality);
  if (active?.jobRecordId) return { renderId: active.id, jobId: active.jobRecordId };

  const renderId = randomUUID();
  const { width, height, fps } = snapshot.render;
  await createRenderRecord({
    id: renderId,
    videoId,
    scriptVersion: snapshot.video.scriptVersion,
    outputPath: `videos/${videoId}/renders/${renderId}-${quality.toLowerCase()}.mp4`,
    qualityPreset: quality,
    width,
    height,
    fps,
    snapshotJson: snapshot,
    snapshotHash: hash,
  });

  try {
    const { job } = await enqueueTrackedJob({
      jobType: "RENDER_VIDEO",
      entityType: "RENDER",
      entityId: renderId,
      payload: { renderId },
    });
    await attachRenderJob(renderId, job.id);
    return { renderId, jobId: job.id };
  } catch (error) {
    await failRenderRecord(renderId, "FAILED", "Không thể đưa yêu cầu render vào hàng đợi.");
    throw error;
  }
}
