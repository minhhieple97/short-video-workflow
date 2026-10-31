import { AbsoluteFill, useCurrentFrame } from "remotion";

import type { ShotSize } from "@/features/videos/domain/scene-shots";
import type { ResolvedShot } from "@/features/videos/domain/shot-timeline";

import type { PeepLook } from "../peeps/peep";
import { Camera, type CameraFraming } from "./camera";
import { ACTION_POSES, faceFor, PARTNER_POSES, STANDING_POSES, type CastPose, type Cast } from "./cast";
import { CastExtras } from "./extras";
import { PeepActor } from "./peep-actor";
import { SETS } from "./sets/sets";
import { ShotProps, ShotTag } from "./shot-overlays";

// Where the character stands: a half-body figure ends behind the set's furniture top (y 1180), a whole one stands on the
// ground line (y 1260). Both keep the head in the picture band, below the headline.
const HALF = { x: 486, bottom: 1220, height: 600 } as const;
const WHOLE = { x: 486, bottom: 1262, height: 650 } as const;
// Two whole figures side by side, the main character on the right. The partner turns to face it, except when the two walk
// on together.
const PAIR = { mainX: 700, partnerX: 360, bottom: 1262, height: 560 } as const;

type Framing = [CameraFraming, CameraFraming];

// Each shot size frames the character a little closer and drifts slowly (never a fast zoom).
const FRAMING: Record<"half" | "whole" | "pair", Record<ShotSize, Framing>> = {
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
  // Two figures never get a closer frame than medium: it would cut one of them.
  pair: {
    WIDE: [
      { x: 505, y: 950, zoom: 1 },
      { x: 505, y: 950, zoom: 1.03 },
    ],
    MEDIUM: [
      { x: 505, y: 860, zoom: 1.2 },
      { x: 505, y: 860, zoom: 1.25 },
    ],
    CLOSE: [
      { x: 505, y: 860, zoom: 1.2 },
      { x: 505, y: 860, zoom: 1.25 },
    ],
  },
};

const walkOffset = (pose: CastPose, frame: number) => (pose.walks ? Math.min(220, frame * 1.4) - 110 : 0);
const stepLift = (pose: CastPose, frame: number) => (pose.walks ? Math.abs(Math.sin(frame / 6)) * 8 : 0);

export function StageShot({
  shot,
  look,
  partnerLook,
  durationInFrames,
  cast,
}: {
  shot: ResolvedShot;
  look: PeepLook;
  partnerLook: PeepLook;
  durationInFrames: number;
  cast?: Cast;
}) {
  const frame = useCurrentFrame();
  const set = SETS[shot.setting];
  const actors = cast?.characters ? shot.actors : undefined;
  const first = actors?.[0];
  const second = actors?.[1];
  const actorLook = first ? cast?.characters?.[first.characterId] : look;
  const secondLook = second ? cast?.characters?.[second.characterId] : partnerLook;
  if (!actorLook || !secondLook) throw new Error("Unknown character in shot.");
  const paired = actors ? second !== undefined : shot.partner !== null;
  const action = first?.action ?? shot.action;
  const pose = paired ? STANDING_POSES[action] : ACTION_POSES[action];
  const partnerPose = actors
    ? second
      ? STANDING_POSES[second.action]
      : null
    : shot.partner
      ? PARTNER_POSES[shot.partner]
      : null;
  const place = pose.full ? WHOLE : HALF;
  const [from, to] = FRAMING[paired ? "pair" : pose.full ? "whole" : "half"][shot.size];
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: set.background }}>
      <Camera from={from} to={to} durationInFrames={durationInFrames}>
        <set.Back />
        {pose.full ? <set.Ground /> : null}
        {partnerPose ? (
          <PeepActor
            body={partnerPose.body}
            face={faceFor(partnerPose, shot.size)}
            look={secondLook}
            x={PAIR.partnerX + walkOffset(partnerPose, frame)}
            bottom={PAIR.bottom - stepLift(partnerPose, frame)}
            height={PAIR.height}
            flip={!partnerPose.walks}
          />
        ) : null}
        {actors?.length === 0 ? null : (
          <PeepActor
            body={pose.body}
            face={faceFor(pose, shot.size, shot.mood)}
            look={actorLook}
            x={(paired ? PAIR.mainX : place.x) + walkOffset(pose, frame)}
            bottom={(paired ? PAIR.bottom : place.bottom) - stepLift(pose, frame)}
            height={paired ? PAIR.height : place.height}
          />
        )}
        {pose.full ? null : <set.Front />}
        {!paired && pose.extra ? <CastExtras extra={pose.extra} /> : null}
      </Camera>
      {shot.props.length > 0 ? <ShotProps props={shot.props} /> : null}
      {shot.tag ? <ShotTag text={shot.tag} /> : null}
    </AbsoluteFill>
  );
}
