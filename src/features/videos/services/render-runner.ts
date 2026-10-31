import fs from "node:fs/promises";

import type { RenderRecord } from "@/generated/prisma/client";
import { probeMedia } from "@/server/media/ffprobe";
import { startAssetServer, type AssetServer, type ServedAsset } from "@/server/render/asset-server";
import { makeRenderCancelSignal, renderShortVideo } from "@/server/render/render-short-video";
import { dataPath } from "@/server/storage/paths";
import { getAppConfig } from "@/shared/config/env";
import { AppError, JobCancelledError, NotFoundError } from "@/shared/errors";
import { createLogger, toSafeErrorMessage } from "@/shared/logger";
import { currentArchiveDestination } from "@/features/archive/services/archive-request.service";

import { shortVideoPropsSchema, toCompositionProps } from "../domain/composition-props";
import { runPreflight } from "../domain/preflight";
import { toCompositionSource, toPreflightInput, type RenderSnapshot } from "../domain/render-snapshot";
import {
  completeRenderRecord,
  failRenderRecord,
  findRenderRecord,
  markRenderStarted,
} from "../repositories/render.repository";
import { resolveRenderSnapshot } from "./render-snapshot.service";

const logger = createLogger("render.runner");
const DURATION_TOLERANCE_MS = 500;

async function missingArchiveDestination(): Promise<boolean> {
  try {
    return !(await currentArchiveDestination());
  } catch {
    logger.warn("Drive connection could not be read; the completed render remains available locally");
    return true;
  }
}

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
    return `Thời lượng ${Math.round(probe.durationMs / 100) / 10}s vượt mức tối đa.`;
  }
  return null;
}

// Serves exactly the audio the snapshot names, by the path it was stored under. The files are named by their content, so
// they are what the snapshot saw; one that has gone missing fails the render instead of leaving a silent scene.
async function serveNarration(snapshot: RenderSnapshot): Promise<AssetServer> {
  const used = new Set(
    snapshot.scenes.flatMap((scene) => (!scene.hidden && scene.audioAssetId ? [scene.audioAssetId] : [])),
  );
  const served = new Map<string, ServedAsset>();
  for (const audio of snapshot.audio.filter((candidate) => used.has(candidate.assetId))) {
    const absolutePath = dataPath(audio.path);
    await fs.stat(absolutePath).catch(() => {
      throw new AppError("RENDER_AUDIO_MISSING", "Một tệp giọng đọc của bản render không còn tồn tại.", 409);
    });
    served.set(audio.assetId, { absolutePath, mimeType: audio.mimeType });
  }
  return startAssetServer(served);
}

interface RenderRun {
  renderId: string;
  signal?: AbortSignal;
  onProgress: (progress: number) => Promise<void>;
}

// The heavy collaborators, replaceable so the behaviour around them can be tested without a browser or ffprobe.
export interface RenderDeps {
  renderVideo: typeof renderShortVideo;
  probe: typeof probeMedia;
}

const DEFAULT_DEPS: RenderDeps = { renderVideo: renderShortVideo, probe: probeMedia };

// Renders from the snapshot, verifies the MP4 and records it as COMPLETED, all or nothing: until that last write succeeds a
// failure or a cancel removes the half-made file and marks the render failed.
async function produceRender(
  render: RenderRecord,
  outputFile: string,
  run: RenderRun,
  deps: RenderDeps,
): Promise<{ durationMs: number }> {
  // The render is made from what was captured when it was requested, never from the video as it is now.
  const snapshot = await resolveRenderSnapshot(render);
  const quality = snapshot.render.quality;
  const report = runPreflight(toPreflightInput(snapshot), quality);
  if (report.blocking.length > 0) {
    throw new AppError("PREFLIGHT_FAILED", report.blocking.map((issue) => issue.message).join(" "), 409);
  }
  await markRenderStarted(render.id, snapshot.video.scriptVersion);
  const assetServer = await serveNarration(snapshot);

  let lastReported = 0;
  const dims = snapshot.render;
  try {
    await deps.renderVideo({
      props: shortVideoPropsSchema.parse(toCompositionProps(toCompositionSource(snapshot), assetServer.urlFor)),
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
  } finally {
    await assetServer.close();
  }

  const probe = await deps.probe(outputFile);
  const problem = verifyOutput(probe, {
    ...dims,
    maxDurationMs: quality === "FINAL" ? toPreflightInput(snapshot).maxDurationSec * 1000 : null,
  });
  if (problem) throw new AppError("RENDER_VERIFICATION_FAILED", `Kiểm tra MP4 thất bại: ${problem}`, 500);

  // Every finished render, draft or final, is archived; the intent is part of this write, so it is saved with the MP4 or
  // not at all. Only a FINAL render is a finished video worth a "no Drive link" warning.
  await completeRenderRecord(
    render,
    { durationMs: probe.durationMs, sizeBytes: probe.sizeBytes },
    { missingDrive: quality === "FINAL" && getAppConfig().telegram.enabled && (await missingArchiveDestination()) },
  );
  return { durationMs: probe.durationMs };
}

// A failed or cancelled render never leaves a half-written MP4 marked as a successful render, and a completed one is
// never undone by anything that happens afterwards.
export async function runRender(
  run: RenderRun,
  deps: RenderDeps = DEFAULT_DEPS,
): Promise<{ renderId: string; durationMs: number }> {
  const render = await findRenderRecord(run.renderId);
  if (!render) throw new NotFoundError("RENDER_NOT_FOUND", "Không tìm thấy bản render.");
  if (render.status === "COMPLETED") return { renderId: render.id, durationMs: render.durationMs ?? 0 };

  const outputFile = dataPath(render.outputPath);
  let result: { durationMs: number };
  try {
    result = await produceRender(render, outputFile, run, deps);
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

  // The MP4 is verified and recorded. From here on only reporting is left, and a failure to report must not touch it.
  await run.onProgress(100).catch((error: unknown) => {
    logger.warn("Could not report the final render progress; the render itself is complete", {
      renderId: render.id,
      error: toSafeErrorMessage(error),
    });
  });
  return { renderId: render.id, durationMs: result.durationMs };
}
