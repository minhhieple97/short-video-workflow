import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { hookPop } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";
import { COLORS } from "../theme/tokens";

export function HookQuestionScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const underline = interpolate(frame, [0, 24], [0, 100], { extrapolateRight: "clamp" });

  return (
    <SceneFrame background={COLORS.backgroundAccent}>
      <div style={{ ...hookPop(frame, fps), fontSize: 104, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1 }}>
        {scene.onScreenText}
      </div>
      <div
        style={{ height: 16, width: `${underline}%`, maxWidth: 520, backgroundColor: COLORS.accent, borderRadius: 8 }}
      />
    </SceneFrame>
  );
}
