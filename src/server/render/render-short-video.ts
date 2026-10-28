import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  openBrowser,
  renderMedia,
  selectComposition,
  type BrowserLog,
  type CancelSignal,
} from "@remotion/renderer";

import { SHORT_VIDEO_COMPOSITION_ID, type ShortVideoProps } from "@/features/videos/domain/composition-props";
import { createLogger } from "@/shared/logger";

import { withAppAlias } from "./webpack-override";

const logger = createLogger("render");
let bundleLocation: Promise<string> | null = null;

// Bundling takes a while on a modest CPU, so it happens once per worker process.
export function ensureRemotionBundle(): Promise<string> {
  bundleLocation ??= bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/index.ts"),
    publicDir: path.join(process.cwd(), "public"),
    webpackOverride: withAppAlias,
  }).catch((error: unknown) => {
    bundleLocation = null;
    throw error;
  });
  return bundleLocation;
}

export function makeRenderCancelSignal(signal: AbortSignal | undefined): CancelSignal | undefined {
  if (!signal) return undefined;
  const { cancelSignal, cancel } = makeCancelSignal();
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return cancelSignal;
}

export interface RenderShortVideoOptions {
  props: ShortVideoProps;
  scale: number;
  concurrency: number;
  outputFile: string;
  onProgress: (progress: number) => void;
  cancelSignal?: CancelSignal;
}

// Only problems reach the worker log, cut short: page messages could quote what is on screen.
function logBrowserProblem(log: BrowserLog): void {
  if (log.type !== "error" && log.type !== "warning") return;
  logger.warn("Render browser reported a problem", { type: log.type, text: log.text.slice(0, 300) });
}

// H.264 + AAC (a silent track is added when there is no narration) written to a temp file, then renamed atomically.
// One Chromium serves both the composition lookup and the render instead of a launch for each.
export async function renderShortVideo(options: RenderShortVideoOptions): Promise<void> {
  const serveUrl = await ensureRemotionBundle();
  await fs.mkdir(path.dirname(options.outputFile), { recursive: true });
  const tempFile = `${options.outputFile}.${randomUUID()}.part.mp4`;
  const startedAt = Date.now();
  const browser = await openBrowser("chrome", { logLevel: "error" });

  try {
    const composition = await selectComposition({
      serveUrl,
      id: SHORT_VIDEO_COMPOSITION_ID,
      inputProps: options.props,
      puppeteerInstance: browser,
      onBrowserLog: logBrowserProblem,
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      enforceAudioTrack: true,
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      inputProps: options.props,
      outputLocation: tempFile,
      concurrency: options.concurrency,
      scale: options.scale,
      cancelSignal: options.cancelSignal,
      puppeteerInstance: browser,
      onBrowserLog: logBrowserProblem,
      onProgress: ({ progress }) => options.onProgress(progress),
    });
    await fs.rename(tempFile, options.outputFile);
    logger.info("Render finished", { frames: composition.durationInFrames, seconds: (Date.now() - startedAt) / 1000 });
  } catch (error) {
    await fs.rm(tempFile, { force: true });
    throw error;
  } finally {
    await browser.close({ silent: true });
  }
}
