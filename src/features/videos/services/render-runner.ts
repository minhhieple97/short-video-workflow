import fs from "node:fs/promises";

import { probeMedia } from "@/server/media/ffprobe";
import { makeRenderCancelSignal, renderShortVideo } from "@/server/render/render-short-video";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError, JobCancelledError, NotFoundError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";

import { shortVideoPropsSchema, toCompositionProps } from "../domain/composition-props";
import {
  completeRenderRecord,
  failRenderRecord,
  findRenderRecord,
  markRenderStarted,
} from "../repositories/render.repository";
import { dimensionsFor, preflightFor } from "./render.service";
import { toVideoDetail } from "./video-mapper";
import { requireVideo } from "./video.service";

const logger = createLogger("render.runner");
const DURATION_TOLERANCE_MS = 500;

function verifyOutput(
  probe: Awaited<ReturnType<typeof probeMedia>>,
  expected: { width: number; height: number; fps: number; maxDurationMs: number | null },
): string | null {
  if (!probe.video || probe.video.codec !== "h264") return "Thiếu luồng video H.264.";
  if (!probe.audio || probe.audio.codec !== "aac") return "Thiếu luồng âm thanh AAC.";
  if (probe.video.width !== expected.width || probe.video.height !== expected.height) {
    return `Kích thước ${probe.video.width}×${probe.video.height} khác ${expected.width}×${expected.height}.`;
  }
  if (Math.abs(probe.video.fps - expected.fps) > 0.01)
    return `Tốc độ khung hình ${probe.video.fps} khác ${expected.fps}.`;
  if (expected.maxDurationMs !== null && probe.durationMs > expected.maxDurationMs + DURATION_TOLERANCE_MS) {
    return `Thời lượng ${Math.round(probe.durationMs / 100) / 10}s vượt preset.`;
  }
  return null;
}

interface RenderRun {
  renderId: string;
  signal?: AbortSignal;
  onProgress: (progress: number) => Promise<void>;
}

// A failed or cancelled render never leaves a half-written MP4 marked as a successful render.
export async function runRender(run: RenderRun): Promise<{ renderId: string; durationMs: number }> {
  const render = await findRenderRecord(run.renderId);
  if (!render) throw new NotFoundError("RENDER_NOT_FOUND", "Không tìm thấy bản render.");
  if (render.status === "COMPLETED") return { renderId: render.id, durationMs: render.durationMs ?? 0 };

  const video = toVideoDetail(await requireVideo(render.videoId));
  const quality = render.qualityPreset;
  const outputFile = dataPath(render.outputPath);

  try {
    const report = preflightFor(video, quality);
    if (report.blocking.length > 0) {
      throw new AppError("PREFLIGHT_FAILED", report.blocking.map((issue) => issue.message).join(" "), 409);
    }
    const props = shortVideoPropsSchema.parse(toCompositionProps(video));
    await markRenderStarted(render.id, video.scriptVersion);

    let lastReported = 0;
    const dims = dimensionsFor(quality);
    await renderShortVideo({
      props,
      scale: dims.width / getAppConfig().video.final.width,
      concurrency: getAppConfig().concurrency.render,
      outputFile,
      cancelSignal: makeRenderCancelSignal(run.signal),
      onProgress: (progress) => {
        const percent = Math.round(progress * 90) + 5;
        if (percent - lastReported < 5) return;
        lastReported = percent;
        void run.onProgress(percent).catch(() => undefined);
      },
    });

    const probe = await probeMedia(outputFile);
    const problem = verifyOutput(probe, {
      ...dims,
      maxDurationMs: quality === "FINAL" ? video.targetDurationSec * 1000 : null,
    });
    if (problem) throw new AppError("RENDER_VERIFICATION_FAILED", `Kiểm tra MP4 thất bại: ${problem}`, 500);

    await completeRenderRecord(render, { durationMs: probe.durationMs, sizeBytes: probe.sizeBytes });
    await run.onProgress(100);
    return { renderId: render.id, durationMs: probe.durationMs };
  } catch (error) {
    await fs.rm(outputFile, { force: true });
    if (run.signal?.aborted) {
      await failRenderRecord(render.id, "CANCELLED", "Đã huỷ theo yêu cầu.");
      throw new JobCancelledError();
    }
    await failRenderRecord(render.id, "FAILED", toSafeErrorMessage(error));
    logger.error("Render failed", { renderId: render.id, error: toSafeErrorMessage(error) });
    throw error;
  }
}
