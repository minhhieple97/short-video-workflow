export const VIDEO_FPS = 30;
export const HOOK_MAX_SECONDS = 4;
export const HOOK_MAX_FRAMES = HOOK_MAX_SECONDS * VIDEO_FPS;

// The lengths a video can be planned at. The user picks a range from them and the AI picks one inside it, so the AI chooses
// from a short list and every length keeps a readable label.
export const DURATION_PRESETS_SEC = [30, 45, 60, 90, 120, 180, 240, 300] as const;
export const MAX_TARGET_SEC = 300;
// Past a minute a video may no longer count as a Short or a Reel on every platform.
const SHORT_FORM_MAX_SEC = 60;
export type TargetDurationSec = (typeof DURATION_PRESETS_SEC)[number];

// The lengths the user allows for one video; the final render must not be longer than the maximum.
export interface DurationRange {
  minDurationSec: number;
  maxDurationSec: number;
}

// Scenes (or draft beats) after the hook: enough for a five-minute video at roughly 8–15 seconds a scene.
export const MAX_STORY_SCENES = 30;

export function isDurationPreset(seconds: number): seconds is TargetDurationSec {
  return DURATION_PRESETS_SEC.some((preset) => preset === seconds);
}

export function isLongPreset(seconds: number): boolean {
  return seconds > SHORT_FORM_MAX_SEC;
}

export function formatPreset(seconds: number): string {
  return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} phút` : `${seconds} giây`;
}

export function formatRange(range: DurationRange): string {
  return range.minDurationSec === range.maxDurationSec
    ? formatPreset(range.maxDurationSec)
    : `${formatPreset(range.minDurationSec)} – ${formatPreset(range.maxDurationSec)}`;
}

// "AI đề xuất 60 giây · 30 giây – 5 phút" once a script proposed a length, otherwise just the range.
export function durationLabel(video: DurationRange & { targetDurationSec: number; proposed: boolean }): string {
  const range = formatRange(video);
  return video.proposed ? `AI đề xuất ${formatPreset(video.targetDurationSec)} · ${range}` : `Khoảng ${range}`;
}

export function presetsInRange(range: DurationRange): TargetDurationSec[] {
  return DURATION_PRESETS_SEC.filter((seconds) => seconds >= range.minDurationSec && seconds <= range.maxDurationSec);
}

export function isWithinRange(seconds: number, range: DurationRange): boolean {
  return seconds >= range.minDurationSec && seconds <= range.maxDurationSec;
}

export function clampToRange(seconds: number, range: DurationRange): number {
  return Math.min(Math.max(seconds, range.minDurationSec), range.maxDurationSec);
}

// The shortest allowed length that still holds `seconds` of narration, or the range's maximum when nothing does.
export function fitToRange(seconds: number, range: DurationRange): TargetDurationSec {
  const allowed = presetsInRange(range);
  return allowed.find((preset) => preset >= seconds) ?? allowed.at(-1) ?? MAX_TARGET_SEC;
}

// Natural Vietnamese narration is roughly four syllables a second at the standard pace (a faster pace speaks faster: see
// syllablesPerSecond in pace.ts); real audio length replaces this estimate later.
export const SYLLABLES_PER_SECOND = 4;
const SCENE_PAUSE_SECONDS = 0.4;

export function countSyllables(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function estimateNarrationSeconds(text: string, syllablesPerSecond = SYLLABLES_PER_SECOND): number {
  const syllables = countSyllables(text);
  if (syllables === 0) return 0;
  return Math.round((syllables / syllablesPerSecond + SCENE_PAUSE_SECONDS) * 10) / 10;
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
  // The length the AI planned for; the range is the limit.
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  // Share of the maximum used, for the bar.
  ratio: number;
  level: BudgetLevel;
  message: string;
}

export function assessDurationBudget(
  totalSeconds: number,
  budget: { targetSeconds: number } & DurationRange,
): DurationBudget {
  const { minDurationSec: minSeconds, maxDurationSec: maxSeconds, targetSeconds } = budget;
  const ratio = maxSeconds > 0 ? totalSeconds / maxSeconds : 0;
  const rounded = Math.round(totalSeconds * 10) / 10;
  const base = { totalSeconds: rounded, targetSeconds, minSeconds, maxSeconds, ratio };
  if (totalSeconds === 0) return { ...base, level: "empty", message: "Chưa có lời dẫn." };
  if (ratio > 1) {
    return {
      ...base,
      level: "over",
      message: `Dài hơn ${Math.ceil(totalSeconds - maxSeconds)} giây so với mức tối đa ${maxSeconds} giây. Hãy rút gọn lời dẫn, ẩn bớt cảnh hoặc nới khoảng thời lượng.`,
    };
  }
  if (ratio > 0.9) return { ...base, level: "near", message: "Sát mức tối đa — thời lượng audio thật có thể vượt." };
  if (totalSeconds < minSeconds) {
    return {
      ...base,
      level: "short",
      message: `Ngắn hơn mức tối thiểu ${minSeconds} giây; có thể kể sâu hơn tình huống hoặc hành động.`,
    };
  }
  return { ...base, level: "ok", message: "Trong khoảng thời lượng." };
}

const MIN_SECONDS_PER_LESSON = 25;

export type LessonLoad = "ok" | "tight" | "overload";

// One lesson per short video is the norm; a second lesson needs room for its own scenario and action.
export function assessLessonLoad(lessonCount: number, maxSeconds: number): { level: LessonLoad; message: string } {
  const needed = HOOK_MAX_SECONDS + lessonCount * MIN_SECONDS_PER_LESSON;
  if (lessonCount <= 1) return { level: "ok", message: "Một bài học cho một video — phù hợp nhất với video ngắn." };
  if (needed > maxSeconds) {
    return {
      level: "overload",
      message: `${lessonCount} bài học cần khoảng ${needed} giây, vượt mức tối đa ${maxSeconds} giây. Nên bỏ bớt bài học, tách thành ${lessonCount} video hoặc nới khoảng thời lượng.`,
    };
  }
  return {
    level: "tight",
    message: `${lessonCount} bài học trong tối đa ${maxSeconds} giây: chỉ phù hợp nếu các bài học bổ trợ nhau. Cân nhắc tách thành nhiều video.`,
  };
}
