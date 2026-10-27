import { AbsoluteFill } from "remotion";

import { COLORS, FONT_FAMILY } from "../theme/tokens";

export function PlaceholderComposition() {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        color: COLORS.foreground,
        fontFamily: FONT_FAMILY,
        justifyContent: "center",
        alignItems: "center",
        padding: 96,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 800, color: COLORS.accent }}>Book Video Studio</div>
      <div style={{ fontSize: 56, marginTop: 48 }}>Khung dựng thử 9:16 — cảnh thật sẽ có ở M4</div>
    </AbsoluteFill>
  );
}
