import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";

import { enter, hookPop } from "../components/motion";
import { SceneFrame } from "../components/scene-frame";
import { COLORS } from "../theme/tokens";

export function BigTakeawayScene({ scene }: Readonly<{ scene: CompositionScene }>) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const highlight = interpolate(frame, [6, 30], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const motion = scene.type === "HOOK" ? hookPop(frame, fps) : enter(frame, fps);

  return (
    <SceneFrame label={scene.type === "HOOK" ? undefined : scene.label}>
      <div style={{ ...motion, position: "relative", fontSize: 96, fontWeight: 800, lineHeight: 1.12 }}>
        <span
          style={{
            backgroundImage: `linear-gradient(${COLORS.backgroundAccent}, ${COLORS.backgroundAccent})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${highlight}% 40%`,
            backgroundPosition: "0 88%",
          }}
        >
          {scene.onScreenText}
        </span>
      </div>
    </SceneFrame>
  );
}
