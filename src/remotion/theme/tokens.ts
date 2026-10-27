import { CONTENT_SAFE_AREA } from "@/features/videos/domain/safe-zones";

export const CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

export const COLORS = {
  background: "#fff7ed",
  backgroundAccent: "#ffedd5",
  foreground: "#1c1917",
  muted: "#57534e",
  accent: "#ea580c",
  mistake: "#dc2626",
  mistakeSoft: "#fee2e2",
  solution: "#16a34a",
  solutionSoft: "#dcfce7",
  card: "#ffffff",
  captionBackground: "rgba(28, 25, 23, 0.82)",
  captionText: "#ffffff",
} as const;

export const FONT_FAMILY = '"Be Vietnam Pro", "DejaVu Sans", "Segoe UI", sans-serif';

const percent = (value: number, total: number) => Math.round((value / 100) * total);

// Pixel box inside which every important element is placed (strictest of the TikTok / Shorts / Reels defaults).
export const SAFE_BOX = {
  top: percent(CONTENT_SAFE_AREA.top, CANVAS.height),
  bottom: percent(CONTENT_SAFE_AREA.bottom, CANVAS.height),
  left: percent(CONTENT_SAFE_AREA.left, CANVAS.width),
  right: percent(CONTENT_SAFE_AREA.right, CANVAS.width),
} as const;

// Space kept free above the bottom UI zone for subtitles, so scene content never sits under a caption.
export const CAPTION_RESERVE = 260;
