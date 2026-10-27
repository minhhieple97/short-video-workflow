import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      r_frame_rate: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string().optional(), size: z.string().optional() }),
});

export interface MediaProbe {
  durationMs: number;
  sizeBytes: number;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: { codec: string } | null;
}

function parseFrameRate(value: string | undefined): number {
  const [numerator, denominator] = (value ?? "0/1").split("/").map(Number);
  return denominator ? Math.round(((numerator ?? 0) / denominator) * 100) / 100 : 0;
}

// Runs ffprobe with an argument array (no shell) and returns the facts needed to verify renders and audio.
export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { timeout: 30_000 },
  );
  const parsed = probeSchema.parse(JSON.parse(stdout));
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
  return {
    durationMs: Math.round(Number(parsed.format.duration ?? "0") * 1000),
    sizeBytes: Number(parsed.format.size ?? "0"),
    video: video
      ? {
          codec: video.codec_name ?? "",
          width: video.width ?? 0,
          height: video.height ?? 0,
          fps: parseFrameRate(video.r_frame_rate),
        }
      : null,
    audio: audio ? { codec: audio.codec_name ?? "" } : null,
  };
}
