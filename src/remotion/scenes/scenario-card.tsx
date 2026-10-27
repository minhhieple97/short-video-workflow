import { useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { enter } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";
import { COLORS } from "../theme/tokens";

function PersonIcon() {
  return (
    <svg width="180" height="180" viewBox="0 0 120 120" aria-hidden>
      <circle cx="60" cy="60" r="58" fill={COLORS.backgroundAccent} />
      <circle cx="60" cy="44" r="18" fill={COLORS.accent} />
      <path d="M26 98c4-20 18-30 34-30s30 10 34 30" fill={COLORS.accent} />
    </svg>
  );
}

export function ScenarioCardScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneFrame label={scene.label}>
      <div
        style={{
          ...enter(frame, fps),
          display: "flex",
          flexDirection: "column",
          gap: 36,
          padding: 56,
          borderRadius: 40,
          backgroundColor: COLORS.card,
          boxShadow: "0 18px 40px rgba(28, 25, 23, 0.08)",
        }}
      >
        <PersonIcon />
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.18 }}>{scene.onScreenText}</div>
      </div>
    </SceneFrame>
  );
}
