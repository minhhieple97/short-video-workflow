import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { IllustratedScene } from "../illustration/illustrated-scene";
import { CAPTION_RESERVE, COLORS, FONT_FAMILY, SAFE_BOX } from "../theme/tokens";

interface SceneFrameProps {
  scene: CompositionScene;
  label?: string;
  labelColor?: string;
  children: ReactNode;
}

// Every scene: the animated cartoon fills the frame, and the scene's words sit on an opaque card at the top of the safe
// zone, so they are read first and stay readable whatever is drawn behind them; the character stands below the card.
export function SceneFrame({ scene, label, labelColor = COLORS.accent, children }: Readonly<SceneFrameProps>) {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, fontFamily: FONT_FAMILY, color: COLORS.foreground }}>
      <IllustratedScene illustration={scene.illustration} sceneId={scene.id} />
      <div
        style={{
          position: "absolute",
          top: SAFE_BOX.top,
          bottom: SAFE_BOX.bottom + CAPTION_RESERVE,
          left: SAFE_BOX.left,
          right: SAFE_BOX.right,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            padding: "36px 40px",
            borderRadius: 40,
            backgroundColor: COLORS.card,
            boxShadow: "0 18px 48px rgba(28, 25, 23, 0.22)",
          }}
        >
          {label ? (
            <div
              style={{
                alignSelf: "flex-start",
                padding: "8px 24px",
                borderRadius: 999,
                backgroundColor: labelColor,
                color: "#fff",
                fontSize: 34,
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
      </div>
    </AbsoluteFill>
  );
}
