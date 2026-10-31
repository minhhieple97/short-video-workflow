import "dotenv/config";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { openBrowser, renderMedia, selectComposition } from "@remotion/renderer";

import { getConcurrencySettings } from "@/features/settings/services/concurrency-settings.service";
import { RENDER_TEMPLATE_VERSION, SHORT_VIDEO_COMPOSITION_ID } from "@/features/videos/domain/composition-props";
import { ensureRemotionBundle } from "@/server/render/render-short-video";
import { getAppConfig } from "@/shared/config/env";

import { fixtureProps, loadRenderFixture, serveFixtureAudio } from "./lib/render-fixture";

// Renders a fixture the way the worker does (one browser, H.264 + AAC) and reports wall time per frame. The MP4 goes to a
// temp file that is deleted afterwards. Run nothing else heavy meanwhile: the numbers are only comparable on a quiet machine.
//   pnpm bench:render --fixture real-56s [--quality draft|final] [--frames 0-299] [--concurrency 1] [--runs 1] [--out file.mp4]
// --out keeps the (last) MP4 at that path, to watch what the fixture looks like with today's code.
const { values } = parseArgs({
  options: {
    fixture: { type: "string" },
    quality: { type: "string", default: "final" },
    frames: { type: "string" },
    concurrency: { type: "string" },
    runs: { type: "string", default: "1" },
    out: { type: "string" },
  },
  strict: true,
});

function frameRange(text: string | undefined): [number, number] | null {
  if (!text) return null;
  const match = /^(\d+)-(\d+)$/.exec(text);
  if (!match) throw new Error(`--frames must look like 0-299, got "${text}"`);
  return [Number(match[1]), Number(match[2])];
}

async function main(): Promise<number> {
  if (!values.fixture) {
    console.error(
      "Usage: pnpm bench:render --fixture <name> [--quality draft|final] [--frames a-b] [--concurrency n] [--runs n]",
    );
    return 2;
  }
  if (values.quality !== "draft" && values.quality !== "final") throw new Error("--quality must be draft or final");
  const config = getAppConfig();
  const scale = values.quality === "draft" ? config.video.draft.width / config.video.final.width : 1;
  const concurrency = values.concurrency ? Number(values.concurrency) : (await getConcurrencySettings()).renderThreads;
  const range = frameRange(values.frames);

  const fixture = await loadRenderFixture(values.fixture);
  const bundleStarted = performance.now();
  const serveUrl = await ensureRemotionBundle();
  const bundleMs = performance.now() - bundleStarted;
  const server = await serveFixtureAudio(fixture);
  const browser = await openBrowser("chrome", { logLevel: "error" });
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "bench-render-"));

  try {
    const inputProps = fixtureProps(fixture, server);
    const composition = await selectComposition({
      serveUrl,
      id: SHORT_VIDEO_COMPOSITION_ID,
      inputProps,
      puppeteerInstance: browser,
    });
    const frames = range ? range[1] - range[0] + 1 : composition.durationInFrames;
    for (let run = 1; run <= Number(values.runs); run += 1) {
      let renderedDoneIn: number | null = null;
      let encodedDoneIn: number | null = null;
      const started = performance.now();
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        audioCodec: "aac",
        enforceAudioTrack: true,
        pixelFormat: "yuv420p",
        colorSpace: "bt709",
        inputProps,
        outputLocation: values.out ? path.resolve(values.out) : path.join(outputDir, `${randomUUID()}.mp4`),
        concurrency,
        scale,
        frameRange: range,
        puppeteerInstance: browser,
        onProgress: (progress) => {
          renderedDoneIn = progress.renderedDoneIn ?? renderedDoneIn;
          encodedDoneIn = progress.encodedDoneIn ?? encodedDoneIn;
        },
      });
      const wallMs = performance.now() - started;
      console.log(
        JSON.stringify({
          fixture: fixture.name,
          template: RENDER_TEMPLATE_VERSION,
          quality: values.quality,
          size: `${Math.round(composition.width * scale)}x${Math.round(composition.height * scale)}`,
          frames,
          concurrency,
          run,
          bundleMs: run === 1 ? Math.round(bundleMs) : 0,
          renderedDoneInMs: renderedDoneIn,
          encodedDoneInMs: encodedDoneIn,
          wallMs: Math.round(wallMs),
          wallMsPerFrame: Number((wallMs / frames).toFixed(1)),
        }),
      );
    }
    return 0;
  } finally {
    await browser.close({ silent: true });
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
