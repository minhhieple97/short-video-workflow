import { LEADING_SILENCE_WARNING_MS } from "./audio";
import { HOOK_MAX_FRAMES, HOOK_MAX_SECONDS, MAX_TARGET_SEC, VIDEO_FPS, effectiveSceneFrames } from "./duration";
import type { SceneType } from "./scene-types";

export type RenderQuality = "DRAFT" | "FINAL";

export interface PreflightIssue {
  code: string;
  message: string;
}

export interface PreflightReport {
  blocking: PreflightIssue[];
  warnings: PreflightIssue[];
  totalSeconds: number;
}

export interface PreflightInput {
  status: string;
  // True when the automated readiness checks passed for exactly this version of the script.
  autoReady?: boolean;
  targetDurationSec: number;
  scenes: readonly {
    type: SceneType;
    onScreenText: string;
    narration: string;
    durationFrames: number;
    hidden: boolean;
    audioAssetId: string | null;
    audio?: { leadingSilenceMs: number } | null;
  }[];
}

const MAX_ON_SCREEN_CHARS = 60;
const ABSOLUTE_MAX_SECONDS = MAX_TARGET_SEC;

// Final renders need zero blocking issues; drafts may be rendered with warnings for review.
export function runPreflight(input: PreflightInput, quality: RenderQuality): PreflightReport {
  const blocking: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const visible = input.scenes.filter((scene) => !scene.hidden);
  const frames = visible.reduce((sum, scene) => sum + effectiveSceneFrames(scene.durationFrames), 0);
  const totalSeconds = Math.round((frames / VIDEO_FPS) * 10) / 10;
  const finalOnly = (issue: PreflightIssue) => (quality === "FINAL" ? blocking : warnings).push(issue);

  if (visible.length === 0) blocking.push({ code: "NO_SCENES", message: "Video chưa có cảnh nào hiển thị." });

  const hook = input.scenes[0];
  if (!hook || hook.type !== "HOOK" || hook.hidden) {
    blocking.push({ code: "HOOK_MISSING", message: "Cảnh đầu tiên phải là HOOK hiển thị tại frame 0." });
  } else if (effectiveSceneFrames(hook.durationFrames) > HOOK_MAX_FRAMES) {
    finalOnly({
      code: "HOOK_TOO_LONG",
      message: `HOOK kéo dài ${Math.round((effectiveSceneFrames(hook.durationFrames) / VIDEO_FPS) * 10) / 10}s; tối đa ${HOOK_MAX_SECONDS}s (${HOOK_MAX_FRAMES} frame).`,
    });
  }

  const hookSilence = hook?.type === "HOOK" ? (hook.audio?.leadingSilenceMs ?? 0) : 0;
  if (hookSilence > LEADING_SILENCE_WARNING_MS) {
    warnings.push({
      code: "HOOK_SILENCE",
      message: `Giọng đọc HOOK im lặng ${hookSilence} ms ở đầu — ${HOOK_MAX_SECONDS} giây đầu nên có tiếng ngay. Hãy tạo lại hoặc cắt âm thanh.`,
    });
  }

  if (totalSeconds > ABSOLUTE_MAX_SECONDS) {
    blocking.push({
      code: "OVER_MAX",
      message: `Tổng thời lượng ${totalSeconds}s vượt giới hạn tuyệt đối ${ABSOLUTE_MAX_SECONDS}s.`,
    });
  } else if (totalSeconds > input.targetDurationSec) {
    finalOnly({
      code: "OVER_TARGET",
      message: `Tổng thời lượng ${totalSeconds}s vượt preset ${input.targetDurationSec}s. Rút gọn lời dẫn hoặc đổi preset — không tự cắt lời.`,
    });
  }

  if (input.status !== "APPROVED" && !input.autoReady) {
    finalOnly({
      code: "SCRIPT_NOT_APPROVED",
      message: "Kịch bản chưa được duyệt hoặc kiểm tra tự động chưa đạt (hoặc đã sửa sau đó).",
    });
  }

  visible.forEach((scene, index) => {
    if (scene.onScreenText.trim().length === 0) {
      blocking.push({ code: "EMPTY_TEXT", message: `Cảnh ${index + 1} chưa có chữ trên màn hình.` });
    } else if (scene.onScreenText.length > MAX_ON_SCREEN_CHARS) {
      warnings.push({
        code: "LONG_TEXT",
        message: `Cảnh ${index + 1}: chữ trên màn hình dài ${scene.onScreenText.length} ký tự, có thể tràn vùng an toàn — kiểm tra bằng khung xem trước.`,
      });
    }
  });

  const missingAudio = visible.filter((scene) => !scene.audioAssetId).length;
  if (missingAudio > 0) {
    warnings.push({
      code: "MISSING_AUDIO",
      message: `${missingAudio} cảnh chưa có giọng đọc; video sẽ im lặng ở các cảnh đó và thời lượng dựa trên ước tính.`,
    });
  }

  return { blocking, warnings, totalSeconds };
}
