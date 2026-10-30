import { CONTENT_SAFE_AREA } from "@/features/videos/domain/safe-zones";

export const CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

// Colours that stand for the rendered video itself, so they are fixed values rather than app theme tokens.
export const INK = "#1C1917";
export const PAPER = "#FFFDF8";
export const ACCENT = "#FF7A2F";
export const ACTIVE_WORD = "#FFE14D";
export const MISTAKE = "#E5484D";
export const SOLUTION = "#2BB673";

export const FONT_FAMILY = '"Be Vietnam Pro", "DejaVu Sans", "Segoe UI", sans-serif';

const percent = (value: number, total: number) => Math.round((value / 100) * total);

// Pixel box inside which every important element is placed (strictest of the TikTok / Shorts / Reels defaults).
export const SAFE_BOX = {
  top: percent(CONTENT_SAFE_AREA.top, CANVAS.height),
  bottom: percent(CONTENT_SAFE_AREA.bottom, CANVAS.height),
  left: percent(CONTENT_SAFE_AREA.left, CANVAS.width),
  right: percent(CONTENT_SAFE_AREA.right, CANVAS.width),
} as const;

// Vertical bands of the frame, top to bottom: progress and part label, the headline, the picture, then the captions
// (which end above the bottom of the safe box). Below that, platform UI covers the frame, so only set dressing goes there.
export const LAYOUT = {
  progressY: SAFE_BOX.top + 12,
  chipY: SAFE_BOX.top + 40,
  headlineTop: 320,
  pictureTop: 620,
  pictureBottom: 1260,
  contentWidth: CANVAS.width - SAFE_BOX.left - SAFE_BOX.right,
  contentCenterX: SAFE_BOX.left + (CANVAS.width - SAFE_BOX.left - SAFE_BOX.right) / 2,
} as const;
