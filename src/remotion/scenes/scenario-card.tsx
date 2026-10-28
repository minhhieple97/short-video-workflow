import { useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { enter } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";

export function ScenarioCardScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneFrame scene={scene} label={scene.label}>
      <div style={{ ...enter(frame, fps), fontSize: 72, fontWeight: 800, lineHeight: 1.18 }}>{scene.onScreenText}</div>
    </SceneFrame>
  );
}
