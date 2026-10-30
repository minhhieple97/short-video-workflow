import { edgeTtsWordsScript, resolveEdgeTtsPython } from "@/server/tts/edge/edge-tts-python";
import { getAppConfig } from "@/shared/config/env";

import type { CheckResult } from "../types";
import { readFirstOutputLine } from "./run-command";

export async function checkEdgeTts(): Promise<CheckResult> {
  const { mode, edgeTtsCommand, edgeTtsPython, voice } = getAppConfig().tts;
  if (mode !== "edge-tts") {
    return {
      id: "edge-tts",
      label: "edge-tts",
      status: "info",
      summary: "Không dùng (TTS_MODE=upload) — tải âm thanh lên cho từng cảnh.",
    };
  }
  // The same Python and script that voice the scenes, so "ok" here means voices and their word timings will work.
  const python = resolveEdgeTtsPython({ explicit: edgeTtsPython, command: edgeTtsCommand });
  const details = { Python: python, Lệnh: edgeTtsCommand };
  try {
    const version = await readFirstOutputLine(python, [edgeTtsWordsScript(), "--version"]);
    return {
      id: "edge-tts",
      label: "edge-tts",
      status: "ok",
      summary: `${version || "Đã cài đặt"} · giọng ${voice}, có mốc thời gian từng từ. Nếu tạo giọng báo lỗi 403, chạy \`pip install -U edge-tts\`.`,
      details,
    };
  } catch {
    return {
      id: "edge-tts",
      label: "edge-tts",
      status: "warn",
      summary:
        "Python này chưa có edge-tts (`pip install -U edge-tts`, hoặc đặt EDGE_TTS_PYTHON). Vẫn có thể tải âm thanh MP3/WAV lên.",
      details,
    };
  }
}
