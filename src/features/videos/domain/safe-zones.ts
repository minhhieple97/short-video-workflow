export const PLATFORM_PREVIEW_MODES = ["TIKTOK", "YOUTUBE_SHORTS", "FACEBOOK_REELS"] as const;
export type PlatformPreviewMode = (typeof PLATFORM_PREVIEW_MODES)[number];

export const PLATFORM_LABELS: Record<PlatformPreviewMode, string> = {
  TIKTOK: "TikTok",
  YOUTUBE_SHORTS: "YouTube Shorts",
  FACEBOOK_REELS: "Facebook Reels",
};

// The editor previews the full-size composition scaled down in the browser; nothing is rendered to a file.
export const PREVIEW_FRAME = { width: 360, height: 640 } as const;

// Insets in % of the 9:16 frame covered by app UI. These are editable app defaults, not official platform specs:
// platform layouts change by app version, device and caption length.
export interface SafeZoneInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const SAFE_ZONE_DEFAULTS: Record<PlatformPreviewMode, SafeZoneInsets> = {
  TIKTOK: { top: 10, bottom: 22, left: 5, right: 15 },
  YOUTUBE_SHORTS: { top: 9, bottom: 20, left: 5, right: 14 },
  FACEBOOK_REELS: { top: 10, bottom: 23, left: 5, right: 14 },
};

// Content is laid out inside the strictest combination so one render works on every platform.
export const CONTENT_SAFE_AREA: SafeZoneInsets = {
  top: Math.max(...Object.values(SAFE_ZONE_DEFAULTS).map((zone) => zone.top)),
  bottom: Math.max(...Object.values(SAFE_ZONE_DEFAULTS).map((zone) => zone.bottom)),
  left: Math.max(...Object.values(SAFE_ZONE_DEFAULTS).map((zone) => zone.left)),
  right: Math.max(...Object.values(SAFE_ZONE_DEFAULTS).map((zone) => zone.right)),
};

export function toPlatformPreviewMode(value: string | null | undefined): PlatformPreviewMode {
  return PLATFORM_PREVIEW_MODES.find((mode) => mode === value) ?? "TIKTOK";
}
