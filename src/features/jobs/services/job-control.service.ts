import "server-only";

import { requestChapterAnalysis } from "@/features/chapters/services/analysis-request.service";
import { findSceneWithVideo } from "@/features/videos/repositories/audio.repository";
import { findRenderRecord } from "@/features/videos/repositories/render.repository";
import { requestSceneTts } from "@/features/videos/services/audio-request.service";
import { requestRender } from "@/features/videos/services/render-request.service";
import { requestSceneRegeneration, requestScriptGeneration } from "@/features/videos/services/script-request.service";
import { cancelWaitingJob } from "@/server/queue/queue";
import { AppError, NotFoundError } from "@/shared/errors";
import type { JobDto } from "@/shared/types/job";

import { failWaitingAiRuns } from "../repositories/ai-run.repository";
import { deleteUndeliveredIntent } from "../repositories/job-dispatch.repository";
import { findJobRecordById, markJobCancelled, markJobCancelRequested } from "../repositories/job-record.repository";
import { releaseJobEntity } from "./job-effects";
import { enqueueDiagnosticPingJob, getJob } from "./job-service";

async function requireJob(id: string) {
  const record = await findJobRecordById(id);
  if (!record) throw new NotFoundError("JOB_NOT_FOUND", "Không tìm thấy tác vụ.");
  return record;
}

// Queued and CLI-waiting jobs stop immediately; a running job is asked to stop and the worker finishes the cancel.
// A queued job still in the outbox is cancelled without touching Redis.
export async function cancelJob(id: string): Promise<JobDto> {
  const record = await requireJob(id);
  if (
    record.status === "WAITING_FOR_CLI" ||
    (record.status === "QUEUED" &&
      ((await deleteUndeliveredIntent(id)) || (await cancelWaitingJob(record.bullmqJobId))))
  ) {
    await markJobCancelled(id);
    await failWaitingAiRuns(id, "Đã huỷ theo yêu cầu.");
    await releaseJobEntity(record, "CANCELLED", "Đã huỷ theo yêu cầu.");
  } else if (record.status === "RUNNING" || record.status === "QUEUED") {
    await markJobCancelRequested(id);
  } else {
    throw new AppError("JOB_NOT_CANCELLABLE", "Tác vụ đã kết thúc, không thể huỷ.", 409);
  }
  return getJob(id);
}

// A retry is a fresh job built from the same entity, so the history of the failed attempt is kept.
export async function retryJob(id: string): Promise<JobDto> {
  const record = await requireJob(id);
  if (record.status !== "FAILED" && record.status !== "CANCELLED") {
    throw new AppError("JOB_NOT_RETRYABLE", "Chỉ thử lại được tác vụ lỗi hoặc đã huỷ.", 409);
  }

  switch (record.jobType) {
    case "DIAGNOSTIC_PING":
      return enqueueDiagnosticPingJob();
    case "ANALYZE_CHAPTER":
      return requestChapterAnalysis(record.entityId, true);
    case "GENERATE_VIDEO_SCRIPT": {
      if (record.entityType === "VIDEO") return requestScriptGeneration(record.entityId);
      const scene = await findSceneWithVideo(record.entityId);
      if (!scene) throw new NotFoundError("SCENE_NOT_FOUND", "Cảnh không còn tồn tại.");
      return requestSceneRegeneration(scene.video.id, scene.id);
    }
    case "GENERATE_SCENE_TTS":
      return requestSceneTts(record.entityId);
    case "RENDER_VIDEO": {
      const render = await findRenderRecord(record.entityId);
      if (!render) throw new NotFoundError("RENDER_NOT_FOUND", "Bản render không còn tồn tại.");
      const { jobId } = await requestRender(render.videoId, render.qualityPreset);
      return getJob(jobId);
    }
    default:
      throw new AppError("JOB_NOT_RETRYABLE", "Loại tác vụ này không hỗ trợ thử lại.", 409);
  }
}
