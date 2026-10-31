import "dotenv/config";

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "node:util";

import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

import { SHORT_VIDEO_COMPOSITION_ID, type ShortVideoProps } from "@/features/videos/domain/composition-props";
import { ensureRemotionBundle } from "@/server/render/render-short-video";
import { dataPath } from "@/server/storage/paths";

import { fixtureProps, loadRenderFixture, serveFixtureAudio } from "./lib/render-fixture";

const execFileAsync = promisify(execFile);
const COLUMNS = 4;

// Renders four stills per scene (its first frame, just after its entrance, its middle and its last frame), or with --shots
// one still a second into every shot, and tiles them into one contact sheet under
// DATA_DIR/diagnostics/stills/<fixture>-<time>/contact.png.
//   pnpm render:stills --fixture real-56s [--scale 0.3] [--shots]
const { values } = parseArgs({
  options: {
    fixture: { type: "string" },
    scale: { type: "string", default: "0.3" },
    shots: { type: "boolean", default: false },
  },
  strict: true,
});

// A second into each shot, once its entrance has settled (or its middle, for a shorter shot).
function framesPerShot(props: ShortVideoProps): number[] {
  let start = 0;
  return props.scenes.flatMap((scene) => {
    const frames = scene.shots.map(
      (shot) => start + shot.startFrame + Math.min(30, Math.floor(shot.durationInFrames / 2)),
    );
    start += scene.durationInFrames;
    return frames;
  });
}

function framesPerScene(props: ShortVideoProps): number[] {
  const frames: number[] = [];
  let start = 0;
  for (const scene of props.scenes) {
    const last = start + scene.durationInFrames - 1;
    frames.push(start, Math.min(start + 15, last), start + Math.floor(scene.durationInFrames / 2), last);
    start += scene.durationInFrames;
  }
  return frames;
}

async function main(): Promise<number> {
  if (!values.fixture) {
    console.error("Usage: pnpm render:stills --fixture <name> [--scale 0.3] [--shots]");
    return 2;
  }
  const scale = Number(values.scale);
  const fixture = await loadRenderFixture(values.fixture);
  const serveUrl = await ensureRemotionBundle();
  const server = await serveFixtureAudio(fixture);
  const browser = await openBrowser("chrome", { logLevel: "error" });
  const outputDir = dataPath(
    "diagnostics",
    "stills",
    `${fixture.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await fs.mkdir(outputDir, { recursive: true });

  try {
    const inputProps = fixtureProps(fixture, server);
    const composition = await selectComposition({
      serveUrl,
      id: SHORT_VIDEO_COMPOSITION_ID,
      inputProps,
      puppeteerInstance: browser,
    });
    const frames = values.shots ? framesPerShot(inputProps) : framesPerScene(inputProps);
    for (const [index, frame] of frames.entries()) {
      await renderStill({
        composition,
        serveUrl,
        frame,
        inputProps,
        scale,
        imageFormat: "png",
        output: path.join(outputDir, `still-${String(index).padStart(3, "0")}.png`),
        puppeteerInstance: browser,
      });
    }
    const rows = Math.ceil(frames.length / COLUMNS);
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        "1",
        // Chromium writes some stills with an alpha channel and some without; rebuilding the filters at such a change would
        // drop the stills gathered so far, so the grid keeps one graph and converts every still to RGB.
        "-reinit_filter",
        "0",
        "-i",
        path.join(outputDir, "still-%03d.png"),
        "-vf",
        `format=rgb24,tile=${COLUMNS}x${rows}:padding=6:color=white`,
        "-frames:v",
        "1",
        path.join(outputDir, "contact.png"),
      ],
      { timeout: 120_000 },
    );
    console.log(path.join(outputDir, "contact.png"));
    return 0;
  } finally {
    await browser.close({ silent: true });
    await server.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
