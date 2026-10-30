import { useMemo } from "react";
import { AbsoluteFill, Sequence, Series, spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";
import { renderModeFor } from "@/features/videos/domain/scene-shots";

import type { PeepLook } from "../peeps/peep";
import { Prop } from "../props/prop";
import { SETS } from "../stage/sets/sets";
import { StageShot } from "../stage/stage-shot";
import { balanceLines } from "../text/balance-lines";
import { autoEmphasis } from "../text/emphasis";
import { KineticHeadline } from "../text/kinetic-headline";
import { TextScene } from "../text/text-scene";
import { INK, SAFE_BOX } from "../theme/tokens";

// The ✗ or ✓ that marks the mistake and the better way in a split layout.
function Stamp({ type, enterAt }: { type: CompositionScene["type"]; enterAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - enterAt - 8, fps, config: { damping: 10, stiffness: 160 } });
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      <g transform={`translate(${1080 - SAFE_BOX.right - 70} 700) scale(${pop}) rotate(${(1 - pop) * -30})`}>
        <Prop id={type === "BETTER_APPROACH" ? "CHECK" : "CROSS"} x={-60} y={-60} size={120} />
      </g>
    </svg>
  );
}

// The scene's on-screen words, shown once for the whole scene (they do not re-animate at each shot cut). Over a closer
// shot every word sits on a light block so it stays readable on any picture.
function SceneHeadline({ scene, enterAt }: { scene: CompositionScene; enterAt: number }) {
  const frame = useCurrentFrame();
  const lines = useMemo(() => balanceLines(scene.onScreenText, 16, 3), [scene.onScreenText]);
  const shot = scene.shots.find((candidate) => frame < candidate.startFrame + candidate.durationInFrames);
  const dark = SETS[scene.illustration.setting].dark;
  return (
    <KineticHeadline
      lines={lines}
      emphasis={autoEmphasis(scene.onScreenText, lines)}
      enterAt={enterAt}
      visibleAtStart={scene.type === "HOOK"}
      maxFontSize={lines.length > 2 ? 96 : 116}
      plate={shot !== undefined && shot.size !== "WIDE"}
      color={dark ? "#FFFFFF" : INK}
    />
  );
}

export function SceneView({
  scene,
  look,
  paceFactor,
  enterAt,
  tailFrames,
}: {
  scene: CompositionScene;
  look: PeepLook;
  paceFactor: number;
  enterAt: number;
  // Frames the picture stays up after the voice, under the transition into the next scene.
  tailFrames: number;
}) {
  const mode = renderModeFor(scene.layout);
  const hook = scene.type === "HOOK";
  return (
    <AbsoluteFill>
      <Series>
        {scene.shots.map((shot, index) => (
          <Series.Sequence
            key={shot.startFrame}
            durationInFrames={shot.durationInFrames + (index === scene.shots.length - 1 ? tailFrames : 0)}
          >
            {/* Only the picture runs on the faster clock; the shot keeps its real length, so cuts stay on the words. */}
            <Sequence playbackRate={paceFactor}>
              {mode === "STAGE" ? (
                <StageShot
                  illustration={scene.illustration}
                  size={shot.size}
                  look={look}
                  durationInFrames={shot.durationInFrames}
                />
              ) : (
                <TextScene
                  text={scene.onScreenText}
                  layout={scene.layout}
                  look={look}
                  enterAt={enterAt}
                  visibleAtStart={hook}
                />
              )}
            </Sequence>
          </Series.Sequence>
        ))}
      </Series>
      {mode === "STAGE" ? <SceneHeadline scene={scene} enterAt={enterAt} /> : null}
      {mode === "STAGE" && scene.layout === "SPLIT_MISTAKE_SOLUTION" ? (
        <Stamp type={scene.type} enterAt={enterAt} />
      ) : null}
    </AbsoluteFill>
  );
}
