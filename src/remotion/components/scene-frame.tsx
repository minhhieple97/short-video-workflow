import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";

import { CAPTION_RESERVE, COLORS, FONT_FAMILY, SAFE_BOX } from "../theme/tokens";

interface SceneFrameProps {
  label?: string;
  labelColor?: string;
  background?: string;
  children: ReactNode;
}

export function SceneFrame({
  label,
  labelColor = COLORS.accent,
  background = COLORS.background,
  children,
}: Readonly<SceneFrameProps>) {
  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: FONT_FAMILY, color: COLORS.foreground }}>
      <div
        style={{
          position: "absolute",
          top: SAFE_BOX.top,
          bottom: SAFE_BOX.bottom + CAPTION_RESERVE,
          left: SAFE_BOX.left,
          right: SAFE_BOX.right,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 40,
        }}
      >
        {label ? (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "10px 28px",
              borderRadius: 999,
              backgroundColor: labelColor,
              color: "#fff",
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
        ) : null}
        {children}
      </div>
    </AbsoluteFill>
  );
}
