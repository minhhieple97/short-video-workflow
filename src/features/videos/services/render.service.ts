import { getAppConfig } from "@/shared/config/env";

import { runPreflight, type PreflightReport, type RenderQuality } from "../domain/preflight";
import { findRenderSizes, listRenderRecords } from "../repositories/render.repository";
import type { RenderDto, VideoDetail } from "../schemas/video.dto";
import { requireVideo } from "./video.service";

export function preflightFor(video: VideoDetail, quality: RenderQuality): PreflightReport {
  return runPreflight(video, quality);
}

export function dimensionsFor(quality: RenderQuality) {
  const { final, draft } = getAppConfig().video;
  return quality === "FINAL" ? final : draft;
}

const RENDER_STATUSES: readonly RenderDto["status"][] = ["QUEUED", "RENDERING", "COMPLETED", "FAILED", "CANCELLED"];

function toRenderStatus(value: string): RenderDto["status"] {
  return RENDER_STATUSES.find((status) => status === value) ?? "FAILED";
}

export async function listRenders(videoId: string): Promise<RenderDto[]> {
  const video = await requireVideo(videoId);
  const [renders, sizes] = await Promise.all([listRenderRecords(videoId), findRenderSizes(videoId)]);
  const sizeByPath = new Map(sizes.map((asset) => [asset.path, asset.fileSizeBytes]));
  return renders.map((render) => {
    const completed = render.status === "COMPLETED";
    return {
      id: render.id,
      quality: render.qualityPreset,
      status: toRenderStatus(render.status),
      width: render.width,
      height: render.height,
      fps: render.fps,
      scriptVersion: render.scriptVersion,
      outdated: completed && render.scriptVersion < video.scriptVersion,
      durationMs: render.durationMs,
      sizeBytes: sizeByPath.get(render.outputPath) ?? null,
      errorMessage: render.errorMessage,
      createdAt: render.createdAt.toISOString(),
      completedAt: render.completedAt?.toISOString() ?? null,
      fileUrl: completed ? `/api/renders/${render.id}/file` : null,
      downloadUrl: completed ? `/api/renders/${render.id}/file?download=1` : null,
    };
  });
}
