import pkg from "../../../package.json";
import { PREVIEW_FRAME } from "@/features/videos/domain/safe-zones";
import { resolveDatabaseFile } from "@/server/db/client";
import { redactRedisUrl } from "@/server/queue/redis-connection";
import { getAppConfig } from "@/shared/config/env";
import { toSafeErrorMessage } from "@/shared/logger";

import { checkClaudeCli } from "./checks/claude-cli";
import { checkDatabase } from "./checks/database";
import { checkEdgeTts } from "./checks/edge-tts";
import { checkFfmpeg } from "./checks/ffmpeg";
import { checkNodeRuntime } from "./checks/node-runtime";
import { checkRedis } from "./checks/redis";
import { checkRemotionBrowser } from "./checks/remotion-browser";
import { checkWorkerHeartbeat } from "./checks/worker-heartbeat";
import { checkWslResources } from "./checks/wsl-resources";
import type { CheckResult, ConfigRow, DiagnosticsSnapshot } from "./types";

async function runCheck(
  id: string,
  label: string,
  check: () => CheckResult | Promise<CheckResult>,
): Promise<CheckResult> {
  try {
    return await check();
  } catch (error) {
    return { id, label, status: "error", summary: "Kiểm tra thất bại.", details: { Lỗi: toSafeErrorMessage(error) } };
  }
}

function buildConfigRows(): ConfigRow[] {
  const { video, concurrency, ai, tts, redisUrl, dataDir } = getAppConfig();
  return [
    { label: "Hồ sơ video", value: `${video.profile} (${video.aspectRatio})` },
    { label: "Render cuối (final)", value: `${video.final.width}×${video.final.height} @ ${video.final.fps} FPS` },
    { label: "Render nháp (draft)", value: `${video.draft.width}×${video.draft.height} @ ${video.draft.fps} FPS` },
    {
      label: "Xem trước",
      value: `Trình duyệt, khung ${PREVIEW_FRAME.width}×${PREVIEW_FRAME.height} thu nhỏ từ bản cuối (không render tệp)`,
    },
    { label: "Thời lượng mặc định / tối đa", value: `${video.defaultDurationSec}s / ${video.maxDurationSec}s` },
    { label: "Preset thời lượng", value: video.durationPresetsSec.map((seconds) => `${seconds}s`).join(" · ") },
    { label: "Worker concurrency", value: String(concurrency.worker) },
    { label: "Render concurrency", value: String(concurrency.render) },
    { label: "Chế độ AI", value: ai.mode },
    { label: "Chế độ giọng đọc", value: `${tts.mode} (${tts.voice})` },
    { label: "Redis", value: redactRedisUrl(redisUrl) },
    { label: "Thư mục dữ liệu", value: dataDir },
    { label: "Tệp SQLite", value: resolveDatabaseFile() },
  ];
}

export async function getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  const checks = await Promise.all([
    runCheck("node", "Node.js", checkNodeRuntime),
    runCheck("redis", "Redis", checkRedis),
    runCheck("database", "SQLite", checkDatabase),
    runCheck("worker", "Worker", checkWorkerHeartbeat),
    runCheck("ffmpeg", "FFmpeg / ffprobe", checkFfmpeg),
    runCheck("claude-cli", "Claude Code CLI", checkClaudeCli),
    runCheck("edge-tts", "edge-tts", checkEdgeTts),
    runCheck("chromium", "Chromium (Remotion)", checkRemotionBrowser),
    runCheck("resources", "Tài nguyên máy", checkWslResources),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    overall: checks.some((check) => check.status === "error") ? "degraded" : "ok",
    app: { name: pkg.name, version: pkg.version },
    checks,
    config: buildConfigRows(),
  };
}
