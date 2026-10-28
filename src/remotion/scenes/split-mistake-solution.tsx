import { useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { enter, hookPop } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";
import { COLORS } from "../theme/tokens";

export function SplitMistakeSolutionScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isSolution = scene.type === "BETTER_APPROACH";
  const tone = isSolution
    ? { strong: COLORS.solution, soft: COLORS.solutionSoft, mark: "✓" }
    : { strong: COLORS.mistake, soft: COLORS.mistakeSoft, mark: "✗" };
  const motion = scene.type === "HOOK" ? hookPop(frame, fps) : enter(frame, fps);

  return (
    <SceneFrame scene={scene} label={scene.type === "HOOK" ? undefined : scene.label} labelColor={tone.strong}>
      <div
        style={{
          ...motion,
          display: "flex",
          gap: 28,
          alignItems: "flex-start",
          padding: 32,
          borderRadius: 28,
          backgroundColor: tone.soft,
          borderLeft: `18px solid ${tone.strong}`,
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, color: tone.strong }}>{tone.mark}</div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.15 }}>{scene.onScreenText}</div>
      </div>
    </SceneFrame>
  );
}
