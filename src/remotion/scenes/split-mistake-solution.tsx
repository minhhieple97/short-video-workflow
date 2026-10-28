import { useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { enter, hookPop } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";
import { COLORS } from "../theme/tokens";

// Drawn rather than typed: ✓ and ✗ are outside the bundled font, so as text they came from whichever system font the
// browser had, and the preview and the MP4 did not match.
function Mark({ solution, color }: Readonly<{ solution: boolean; color: string }>) {
  return (
    <svg width="84" height="84" viewBox="0 0 100 100" style={{ flexShrink: 0 }} aria-hidden>
      <path
        d={solution ? "M 16 54 L 40 78 L 86 24" : "M 22 22 L 78 78 M 78 22 L 22 78"}
        fill="none"
        stroke={color}
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SplitMistakeSolutionScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isSolution = scene.type === "BETTER_APPROACH";
  const tone = isSolution
    ? { strong: COLORS.solution, soft: COLORS.solutionSoft }
    : { strong: COLORS.mistake, soft: COLORS.mistakeSoft };
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
        <Mark solution={isSolution} color={tone.strong} />
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.15 }}>{scene.onScreenText}</div>
      </div>
    </SceneFrame>
  );
}
