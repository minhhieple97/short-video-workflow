import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SILENCE_THRESHOLD = "-45dB";

// Trims leading and trailing silence (keeping 50 ms) so generated narration starts right away and fits the hook.
export async function trimSilence(inputFile: string, outputFile: string): Promise<void> {
  const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_THRESHOLD}:start_silence=0.05`;
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputFile,
      "-af",
      `${trim},areverse,${trim},areverse`,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "4",
      outputFile,
    ],
    { timeout: 60_000 },
  );
}

// `minSilenceSec` is the shortest pause counted; word timings use a short one so the few tens of milliseconds the trim
// leaves are measured too.
export async function measureLeadingSilenceMs(file: string, minSilenceSec = 0.1): Promise<number> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      `silencedetect=noise=${SILENCE_THRESHOLD}:d=${minSilenceSec}`,
      "-f",
      "null",
      "-",
    ],
    { timeout: 60_000 },
  );
  const start = /silence_start: ([\d.]+)/.exec(stderr);
  const end = /silence_end: ([\d.]+)/.exec(stderr);
  if (!start || Number(start[1]) > 0.01 || !end) return 0;
  return Math.round(Number(end[1]) * 1000);
}
