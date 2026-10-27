import { VIDEO_FPS } from "./duration";

export const TTS_ENGINE_VERSION = "edge-tts-trimmed-v1";
export const MAX_AUDIO_SECONDS = 120;
export const LEADING_SILENCE_WARNING_MS = 500;

export type AudioFormat = "mp3" | "wav";

export const AUDIO_MIME_TYPES: Record<AudioFormat, string> = { mp3: "audio/mpeg", wav: "audio/wav" };

export function formatEdgeTtsRate(speedPercent: number): string {
  return `${speedPercent >= 0 ? "+" : ""}${speedPercent}%`;
}

// Recognises audio by its bytes, not its name: MP3 (ID3 tag or MPEG frame sync) or RIFF/WAVE.
export function detectAudioFormat(bytes: Uint8Array): AudioFormat | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return "mp3";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  return null;
}

// Scene length follows the real narration: audio duration plus a short configurable pause.
export function framesForAudio(durationMs: number, paddingMs: number, fps = VIDEO_FPS): number {
  return Math.max(1, Math.ceil(((durationMs + paddingMs) / 1000) * fps));
}
