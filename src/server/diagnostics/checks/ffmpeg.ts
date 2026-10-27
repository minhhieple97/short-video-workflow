import { toSafeErrorMessage } from "@/shared/logger";

import type { CheckResult } from "../types";
import { readFirstOutputLine } from "./run-command";

async function probeBinary(binary: string): Promise<string> {
  try {
    return await readFirstOutputLine(binary, ["-version"]);
  } catch (error) {
    throw new Error(`${binary}: ${toSafeErrorMessage(error)}`, { cause: error });
  }
}

export async function checkFfmpeg(): Promise<CheckResult> {
  try {
    const [ffmpeg, ffprobe] = await Promise.all([probeBinary("ffmpeg"), probeBinary("ffprobe")]);
    return {
      id: "ffmpeg",
      label: "FFmpeg / ffprobe",
      status: "ok",
      summary: "Đã cài đặt",
      details: { ffmpeg, ffprobe },
    };
  } catch (error) {
    return {
      id: "ffmpeg",
      label: "FFmpeg / ffprobe",
      status: "error",
      summary: "Thiếu ffmpeg hoặc ffprobe. Cài bằng `sudo apt install ffmpeg`.",
      details: { Lỗi: toSafeErrorMessage(error) },
    };
  }
}
