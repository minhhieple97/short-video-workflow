import { getAppConfig } from "@/shared/config/env";

import type { CheckResult } from "../types";
import { readFirstOutputLine } from "./run-command";

export async function checkEdgeTts(): Promise<CheckResult> {
  const { mode, edgeTtsCommand, voice } = getAppConfig().tts;
  if (mode !== "edge-tts") {
    return {
      id: "edge-tts",
      label: "edge-tts",
      status: "info",
      summary: "Không dùng (TTS_MODE=upload) — tải âm thanh lên cho từng cảnh.",
    };
  }
  try {
    const version = await readFirstOutputLine(edgeTtsCommand, ["--version"]);
    return {
      id: "edge-tts",
      label: "edge-tts",
      status: "ok",
      summary: `${version || "Đã cài đặt"} · giọng ${voice}. Nếu tạo giọng báo lỗi 403, chạy \`pip install -U edge-tts\`.`,
      details: { Lệnh: edgeTtsCommand },
    };
  } catch {
    return {
      id: "edge-tts",
      label: "edge-tts",
      status: "warn",
      summary: "Chưa cài edge-tts (`pip install -U edge-tts`). Vẫn có thể tải âm thanh MP3/WAV lên.",
      details: { Lệnh: edgeTtsCommand },
    };
  }
}
