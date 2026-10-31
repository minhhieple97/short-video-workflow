import { useMemo } from "react";
import { AbsoluteFill, Sequence, Series, spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { CompositionScene } from "@/features/videos/domain/composition-props";
import { renderModeFor, shotRenderMode } from "@/features/videos/domain/scene-shots";

import { Prop } from "../props/prop";
import type { Cast } from "../stage/cast";
import { SETS } from "../stage/sets/sets";
import { StageShot } from "../stage/stage-shot";
import { balanceLines } from "../text/balance-lines";
import { CardScene } from "../text/card-scene";
import { autoEmphasis } from "../text/emphasis";
import { KineticHeadline } from "../text/kinetic-headline";
import { TextScene } from "../text/text-scene";
import { INK, SAFE_BOX } from "../theme/tokens";

type Shot = CompositionScene["shots"][number];

const shotAt = (shots: readonly Shot[], frame: number) =>
  shots.find((candidate) => frame < candidate.startFrame + candidate.durationInFrames) ?? shots.at(-1);

// The ✗ or ✓ that marks the mistake and the better way in a split layout.
function Stamp({ scene, enterAt }: { scene: CompositionScene; enterAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (shotAt(scene.shots, frame)?.card) return null;
  const pop = spring({ frame: frame - enterAt - 8, fps, config: { damping: 10, stiffness: 160 } });
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
      <g transform={`translate(${1080 - SAFE_BOX.right - 70} 700) scale(${pop}) rotate(${(1 - pop) * -30})`}>
        <Prop id={scene.type === "BETTER_APPROACH" ? "CHECK" : "CROSS"} x={-60} y={-60} size={120} />
      </g>
    </svg>
  );
}

// The scene's on-screen words, shown once for the whole scene (they do not re-animate at each shot cut) and hidden while a
// text card fills the screen. Over a closer shot every word sits on a light block so it stays readable on any picture.
function SceneHeadline({ scene, enterAt }: { scene: CompositionScene; enterAt: number }) {
  const frame = useCurrentFrame();
  const lines = useMemo(() => balanceLines(scene.onScreenText, 16, 3), [scene.onScreenText]);
  const shot = shotAt(scene.shots, frame);
  if (!shot || shot.card) return null;
  return (
    <KineticHeadline
      lines={lines}
      emphasis={autoEmphasis(scene.onScreenText, lines)}
      enterAt={enterAt}
      visibleAtStart={scene.type === "HOOK"}
      maxFontSize={lines.length > 2 ? 96 : 116}
      plate={shot.size !== "WIDE"}
      color={SETS[shot.setting].dark ? "#FFFFFF" : INK}
    />
  );
}

function ShotPicture({
  scene,
  shot,
  cast,
  enterAt,
  visibleAtStart,
}: {
  scene: CompositionScene;
  shot: Shot;
  cast: Cast;
  enterAt: number;
  visibleAtStart: boolean;
}) {
  if (shot.card) {
    return <CardScene card={shot.card} look={cast.main} enterAt={enterAt} visibleAtStart={visibleAtStart} />;
  }
  if (shotRenderMode(scene.layout, shot) === "TEXT") {
    return (
      <TextScene
        text={scene.onScreenText}
        layout={scene.layout}
        look={cast.main}
        enterAt={enterAt}
        visibleAtStart={visibleAtStart}
      />
    );
  }
  return (
    <StageShot
      shot={shot}
      look={cast.main}
      partnerLook={cast.partner}
      cast={cast}
      durationInFrames={shot.durationInFrames}
    />
  );
}

export function SceneView({
  scene,
  cast,
  paceFactor,
  enterAt,
  tailFrames,
}: {
  scene: CompositionScene;
  cast: Cast;
  paceFactor: number;
  enterAt: number;
  // Frames the picture stays up after the voice, under the transition into the next scene.
  tailFrames: number;
}) {
  const stage = renderModeFor(scene.layout) === "STAGE";
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
              <ShotPicture
                scene={scene}
                shot={shot}
                cast={cast}
                enterAt={index === 0 ? enterAt : 0}
                visibleAtStart={scene.type === "HOOK" && index === 0}
              />
            </Sequence>
          </Series.Sequence>
        ))}
      </Series>
      {stage ? <SceneHeadline scene={scene} enterAt={enterAt} /> : null}
      {stage && scene.layout === "SPLIT_MISTAKE_SOLUTION" ? <Stamp scene={scene} enterAt={enterAt} /> : null}
    </AbsoluteFill>
  );
}
