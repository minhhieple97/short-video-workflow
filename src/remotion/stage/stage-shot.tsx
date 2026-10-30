import { AbsoluteFill, useCurrentFrame } from "remotion";

import type { Illustration } from "@/features/videos/domain/illustration";
import type { ShotSize } from "@/features/videos/domain/scene-shots";

import type { PeepLook } from "../peeps/peep";
import { Camera, type CameraFraming } from "./camera";
import { ACTION_POSES, faceFor } from "./cast";
import { CastExtras } from "./extras";
import { PeepActor } from "./peep-actor";
import { SETS } from "./sets/sets";

// Where the character stands: a half-body figure ends behind the set's furniture top (y 1180), a whole one stands on the
// ground line (y 1260). Both keep the head in the picture band, below the headline.
const HALF = { x: 486, bottom: 1220, height: 600 } as const;
const WHOLE = { x: 486, bottom: 1262, height: 650 } as const;

// Each shot size frames the character a little closer and drifts slowly (never a fast zoom).
const FRAMING: Record<"half" | "whole", Record<ShotSize, [CameraFraming, CameraFraming]>> = {
  half: {
    WIDE: [
      { x: 486, y: 950, zoom: 1 },
      { x: 486, y: 950, zoom: 1.03 },
    ],
    MEDIUM: [
      { x: 500, y: 820, zoom: 1.34 },
      { x: 500, y: 820, zoom: 1.39 },
    ],
    CLOSE: [
      { x: 515, y: 740, zoom: 1.7 },
      { x: 515, y: 740, zoom: 1.76 },
    ],
  },
  whole: {
    WIDE: [
      { x: 486, y: 950, zoom: 1 },
      { x: 486, y: 950, zoom: 1.03 },
    ],
    MEDIUM: [
      { x: 486, y: 780, zoom: 1.25 },
      { x: 486, y: 780, zoom: 1.3 },
    ],
    CLOSE: [
      { x: 500, y: 700, zoom: 1.6 },
      { x: 500, y: 700, zoom: 1.66 },
    ],
  },
};

export function StageShot({
  illustration,
  size,
  look,
  durationInFrames,
}: {
  illustration: Illustration;
  size: ShotSize;
  look: PeepLook;
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();
  const set = SETS[illustration.setting];
  const pose = ACTION_POSES[illustration.action];
  const place = pose.full ? WHOLE : HALF;
  const [from, to] = FRAMING[pose.full ? "whole" : "half"][size];
  const walk = pose.walks ? Math.min(220, frame * 1.4) - 110 : 0;
  const step = pose.walks ? Math.abs(Math.sin(frame / 6)) * 8 : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: set.background }}>
      <Camera from={from} to={to} durationInFrames={durationInFrames}>
        <set.Back />
        {pose.full ? <set.Ground /> : null}
        <PeepActor
          body={pose.body}
          face={faceFor(pose, size)}
          look={look}
          x={place.x + walk}
          bottom={place.bottom - step}
          height={place.height}
        />
        {pose.full ? null : <set.Front />}
        {pose.extra ? <CastExtras extra={pose.extra} /> : null}
      </Camera>
    </AbsoluteFill>
  );
}
