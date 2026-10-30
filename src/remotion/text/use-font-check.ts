import { useRemotionEnvironment } from "remotion";

// measureText() calls a font "not loaded" when text measures the same as in the page's own default font. The Player sits in
// the studio page, whose font is this same Be Vietnam Pro, so there the check always fires; `ShortVideo` already draws
// nothing until the font is in. A render, whose page has another default font, keeps the check.
export function useFontCheck(): boolean {
  return !useRemotionEnvironment().isPlayer;
}
