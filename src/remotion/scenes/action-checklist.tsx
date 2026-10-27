import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { enter } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";
import { COLORS } from "../theme/tokens";

export function ActionChecklistScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tick = interpolate(frame, [10, 28], [60, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame label={scene.label} labelColor={COLORS.solution}>
      <div style={{ ...enter(frame, fps), display: "flex", gap: 36, alignItems: "flex-start" }}>
        <svg width="140" height="140" viewBox="0 0 100 100" style={{ flexShrink: 0 }} aria-hidden>
          <rect
            x="6"
            y="6"
            width="88"
            height="88"
            rx="20"
            fill={COLORS.solutionSoft}
            stroke={COLORS.solution}
            strokeWidth="6"
          />
          <path
            d="M28 52 L44 68 L74 34"
            fill="none"
            stroke={COLORS.solution}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="60"
            strokeDashoffset={tick}
          />
        </svg>
        <div style={{ fontSize: 80, fontWeight: 800, lineHeight: 1.15 }}>{scene.onScreenText}</div>
      </div>
    </SceneFrame>
  );
}
