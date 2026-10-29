import { SYLLABLES_PER_SECOND } from "./duration";

// The reading pace the user picks for a video or a batch: one choice that sets how fast the voice speaks, how long the
// pause after each scene is and how many words the AI may write for a length. The system never changes it by itself.
export const PACES = ["STANDARD", "FAST", "FASTER"] as const;
export type Pace = (typeof PACES)[number];
export const DEFAULT_PACE: Pace = "STANDARD";

export interface PaceProfile {
  label: string;
  // Voice speed relative to normal: 0 is normal, +30 is 30% faster.
  speedPercent: number;
  // The pause after each scene's narration.
  paddingMs: number;
  // How much faster scene animation plays.
  animationFactor: number;
}

const PROFILES: Record<Pace, PaceProfile> = {
  STANDARD: { label: "Chuẩn", speedPercent: 0, paddingMs: 300, animationFactor: 1 },
  FAST: { label: "Nhanh", speedPercent: 15, paddingMs: 200, animationFactor: 1.1 },
  FASTER: { label: "Rất nhanh", speedPercent: 30, paddingMs: 120, animationFactor: 1.2 },
};

export function isPace(value: unknown): value is Pace {
  return PACES.some((pace) => pace === value);
}

// Stored values come from a plain string column, so anything unknown reads as the default.
export function toPace(value: string | null | undefined): Pace {
  return isPace(value) ? value : DEFAULT_PACE;
}

export function paceProfile(pace: Pace): PaceProfile {
  return PROFILES[pace];
}

// How many syllables a second the narration is voiced at: the planning rate the AI prompts and estimates use.
export function syllablesPerSecond(pace: Pace): number {
  return Math.round(SYLLABLES_PER_SECOND * (1 + paceProfile(pace).speedPercent / 100) * 100) / 100;
}

// A voice made by a provider at another speed than the video's pace asks for is out of step. An uploaded clip is left
// alone: the pace does not apply to it, and its speed is unknown.
export function isVoiceStale(audio: { provider: string; speedPercent: number | null }, speedPercent: number): boolean {
  return audio.provider !== "upload" && audio.speedPercent !== null && audio.speedPercent !== speedPercent;
}

// "4" or "5,2": how a rate reads in a Vietnamese prompt or label.
export function formatSyllablesPerSecond(pace: Pace): string {
  return String(syllablesPerSecond(pace)).replace(".", ",");
}

// What a pace means for the user, in one line: how fast it reads and how much more fits in the same length.
export function describePace(pace: Pace): string {
  const { speedPercent, paddingMs } = paceProfile(pace);
  const reading = `≈ ${formatSyllablesPerSecond(pace)} âm tiết/giây, nghỉ ${paddingMs} ms giữa các cảnh`;
  if (speedPercent === 0) return `Nhịp đọc tự nhiên: ${reading}.`;
  return `${reading}. Cùng thời lượng chứa thêm khoảng ${speedPercent}% lời dẫn so với nhịp Chuẩn.`;
}

export function formatSpeedPercent(speedPercent: number): string {
  return `${speedPercent >= 0 ? "+" : ""}${speedPercent}%`;
}
