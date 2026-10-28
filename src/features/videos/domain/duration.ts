export const VIDEO_FPS = 30;
export const HOOK_MAX_SECONDS = 4;
export const HOOK_MAX_FRAMES = HOOK_MAX_SECONDS * VIDEO_FPS;

export const STANDARD_PRESETS_SEC = [30, 45, 60] as const;
// Longer videos, up to five minutes, only on an explicit choice: past a minute a video may no longer count as a Short or a
// Reel on every platform.
export const LONG_PRESETS_SEC = [90, 120, 180, 240, 300] as const;
export const DURATION_PRESETS_SEC = [...STANDARD_PRESETS_SEC, ...LONG_PRESETS_SEC] as const;
export const DEFAULT_TARGET_SEC = 60;
export const MAX_TARGET_SEC = 300;
export type TargetDurationSec = (typeof DURATION_PRESETS_SEC)[number];

// Scenes (or draft beats) after the hook: enough for a five-minute video at roughly 8–15 seconds a scene.
export const MAX_STORY_SCENES = 30;

export function isDurationPreset(seconds: number): seconds is TargetDurationSec {
  return DURATION_PRESETS_SEC.some((preset) => preset === seconds);
}

export function isLongPreset(seconds: number): boolean {
  return seconds > DEFAULT_TARGET_SEC;
}

export function formatPreset(seconds: number): string {
  return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} phút` : `${seconds} giây`;
}

// Natural Vietnamese narration is roughly four syllables a second; real audio length replaces this estimate later.
export const SYLLABLES_PER_SECOND = 4;
const SCENE_PAUSE_SECONDS = 0.4;

export function countSyllables(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function estimateNarrationSeconds(text: string): number {
  const syllables = countSyllables(text);
  if (syllables === 0) return 0;
  return Math.round((syllables / SYLLABLES_PER_SECOND + SCENE_PAUSE_SECONDS) * 10) / 10;
}

export function secondsToFrames(seconds: number, fps = VIDEO_FPS): number {
  return Math.max(1, Math.ceil(seconds * fps));
}

// Short scenes still stay on screen long enough to read their on-screen text.
export const MIN_SCENE_FRAMES = 2 * VIDEO_FPS;

export function effectiveSceneFrames(durationFrames: number): number {
  return Math.max(durationFrames, MIN_SCENE_FRAMES);
}

export type BudgetLevel = "empty" | "short" | "ok" | "near" | "over";

export interface DurationBudget {
  totalSeconds: number;
  targetSeconds: number;
  ratio: number;
  level: BudgetLevel;
  message: string;
}

export function assessDurationBudget(totalSeconds: number, targetSeconds: number): DurationBudget {
  const ratio = targetSeconds > 0 ? totalSeconds / targetSeconds : 0;
  const rounded = Math.round(totalSeconds * 10) / 10;
  const base = { totalSeconds: rounded, targetSeconds, ratio };
  if (totalSeconds === 0) return { ...base, level: "empty", message: "Chưa có lời dẫn." };
  if (ratio > 1) {
    return {
      ...base,
      level: "over",
      message: `Dài hơn ${Math.ceil(totalSeconds - targetSeconds)} giây so với ${targetSeconds} giây. Hãy rút gọn lời dẫn, ẩn bớt cảnh hoặc chọn preset dài hơn.`,
    };
  }
  if (ratio > 0.9) return { ...base, level: "near", message: "Sát giới hạn — thời lượng audio thật có thể vượt." };
  if (ratio < 0.5) return { ...base, level: "short", message: "Khá ngắn so với preset; có thể thêm ví dụ cụ thể." };
  return { ...base, level: "ok", message: "Trong ngân sách thời lượng." };
}

const MIN_SECONDS_PER_LESSON = 25;

export type LessonLoad = "ok" | "tight" | "overload";

// One lesson per short video is the norm; a second lesson needs room for its own scenario and action.
export function assessLessonLoad(lessonCount: number, targetSeconds: number): { level: LessonLoad; message: string } {
  const needed = HOOK_MAX_SECONDS + lessonCount * MIN_SECONDS_PER_LESSON;
  if (lessonCount <= 1) return { level: "ok", message: "Một bài học cho một video — phù hợp nhất với video ngắn." };
  if (needed > targetSeconds) {
    return {
      level: "overload",
      message: `${lessonCount} bài học cần khoảng ${needed} giây, vượt preset ${targetSeconds} giây. Nên bỏ bớt bài học, tách thành ${lessonCount} video hoặc chọn một preset video dài.`,
    };
  }
  return {
    level: "tight",
    message: `${lessonCount} bài học trong ${targetSeconds} giây: chỉ phù hợp nếu các bài học bổ trợ nhau. Cân nhắc tách thành nhiều video.`,
  };
}
