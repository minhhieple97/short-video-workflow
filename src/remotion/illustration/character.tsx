import type { CharacterAction } from "@/features/videos/domain/illustration";

import { cycle, eyeOpen, wave } from "./anim";
import type { CharacterLook } from "./look";

// A flat cartoon person drawn with the feet at (0, 0) and the head about 600 units up. Each arm has an upper arm and a
// forearm, so poses bend at the elbow; every angle is a function of the frame.
interface ArmPose {
  upper: number;
  fore: number;
}

interface Pose {
  dx: number;
  dy: number;
  left: ArmPose;
  right: ArmPose;
  legs: [number, number];
  headTilt: number;
  mouth: "smile" | "open" | "flat" | "worried";
  seated: boolean;
  phone: boolean;
}

const OUTLINE = "#1c1917";
const SHOULDER_Y = -420;
const HIP_Y = -230;
const UPPER_ARM = 100;
const FOREARM = 96;

function poseFor(action: CharacterAction, frame: number): Pose {
  const base: Pose = {
    dx: 0,
    dy: wave(frame, 60, 3),
    left: { upper: 8, fore: 0 },
    right: { upper: -8, fore: 0 },
    legs: [3, -3],
    headTilt: wave(frame, 90, 2),
    mouth: "smile",
    seated: false,
    phone: false,
  };
  switch (action) {
    case "THINKING":
      return {
        ...base,
        right: { upper: -25, fore: 150 },
        headTilt: 6 + wave(frame, 70, 3),
        mouth: "flat",
      };
    case "WORRIED":
      return {
        ...base,
        dx: wave(frame, 7, 3),
        left: { upper: 150, fore: -65 },
        right: { upper: -150, fore: 65 },
        mouth: "worried",
      };
    case "WORKING": {
      const typing = wave(frame, 6, 6);
      return {
        ...base,
        dy: 70,
        left: { upper: 25, fore: -75 + typing },
        right: { upper: -25, fore: 75 - typing },
        headTilt: 4,
        mouth: "flat",
        seated: true,
      };
    }
    case "TALKING":
      return {
        ...base,
        right: { upper: -55 + wave(frame, 40, 14), fore: 45 },
        mouth: cycle(frame, 10) < 0.5 ? "open" : "smile",
      };
    case "WALKING": {
      const swing = wave(frame, 24, 20);
      return {
        ...base,
        dy: -Math.abs(wave(frame, 24, 7)),
        left: { upper: -swing, fore: -10 },
        right: { upper: swing, fore: 10 },
        legs: [swing, -swing],
      };
    }
    case "PHONE":
      return {
        ...base,
        left: { upper: 18, fore: -112 },
        right: { upper: -18, fore: 112 },
        headTilt: 8,
        mouth: "flat",
        phone: true,
      };
    case "IDEA":
      return { ...base, right: { upper: -168, fore: -8 + wave(frame, 30, 4) }, mouth: "open" };
    case "CELEBRATING": {
      const cheer = wave(frame, 16, 12);
      return {
        ...base,
        dy: -Math.abs(wave(frame, 20, 28)),
        left: { upper: 158 + cheer, fore: -12 },
        right: { upper: -158 - cheer, fore: 12 },
        legs: [8, -8],
        mouth: "open",
      };
    }
  }
}

function Arm({
  x,
  pose,
  look,
  holding,
}: Readonly<{ x: number; pose: ArmPose; look: CharacterLook; holding: boolean }>) {
  return (
    <g transform={`translate(${x} ${SHOULDER_Y}) rotate(${pose.upper})`}>
      <rect
        x={-19}
        y={-6}
        width={38}
        height={UPPER_ARM + 12}
        rx={19}
        fill={look.shirt}
        stroke={OUTLINE}
        strokeWidth={4}
      />
      <g transform={`translate(0 ${UPPER_ARM}) rotate(${pose.fore})`}>
        <rect
          x={-16}
          y={-8}
          width={32}
          height={FOREARM + 8}
          rx={16}
          fill={look.skin}
          stroke={OUTLINE}
          strokeWidth={4}
        />
        <circle cx={0} cy={FOREARM + 6} r={20} fill={look.skin} stroke={OUTLINE} strokeWidth={4} />
        {holding ? (
          <rect
            x={-26}
            y={FOREARM - 34}
            width={52}
            height={86}
            rx={10}
            fill="#111827"
            stroke={OUTLINE}
            strokeWidth={3}
          />
        ) : null}
      </g>
    </g>
  );
}

function Leg({ x, angle, look }: Readonly<{ x: number; angle: number; look: CharacterLook }>) {
  return (
    <g transform={`translate(${x} ${HIP_Y}) rotate(${angle})`}>
      <rect x={-22} y={-10} width={44} height={236} rx={20} fill={look.pants} stroke={OUTLINE} strokeWidth={4} />
      <ellipse cx={8} cy={228} rx={40} ry={18} fill="#292524" />
    </g>
  );
}

function Hair({ look }: Readonly<{ look: CharacterLook }>) {
  const cap =
    "M -76 -540 C -78 -620 -20 -640 0 -638 C 30 -640 82 -620 76 -536 C 60 -575 20 -590 -10 -588 C -40 -588 -62 -572 -76 -540 Z";
  return (
    <g fill={look.hair} stroke={OUTLINE} strokeWidth={4}>
      {look.hairStyle === 1 ? <path d="M -78 -548 L -86 -450 L -54 -470 Z M 78 -548 L 86 -450 L 54 -470 Z" /> : null}
      <path d={cap} />
      {look.hairStyle === 2 ? <circle cx={0} cy={-648} r={26} /> : null}
    </g>
  );
}

function Face({ frame, mouth }: Readonly<{ frame: number; mouth: Pose["mouth"] }>) {
  const open = eyeOpen(frame);
  const mouthPath = {
    smile: "M -24 -500 Q 0 -478 24 -500",
    flat: "M -18 -494 L 18 -494",
    worried: "M -22 -488 Q 0 -504 22 -488",
    open: "",
  }[mouth];
  return (
    <g>
      <ellipse cx={-26} cy={-540} rx={8} ry={10 * open} fill={OUTLINE} />
      <ellipse cx={26} cy={-540} rx={8} ry={10 * open} fill={OUTLINE} />
      {mouth === "worried" ? (
        <path d="M -40 -572 L -14 -562 M 40 -572 L 14 -562" stroke={OUTLINE} strokeWidth={5} strokeLinecap="round" />
      ) : null}
      <circle cx={-44} cy={-512} r={10} fill="#f9a8a8" opacity={0.6} />
      <circle cx={44} cy={-512} r={10} fill="#f9a8a8" opacity={0.6} />
      {mouth === "open" ? (
        <ellipse cx={0} cy={-496} rx={16} ry={11} fill="#7f1d1d" />
      ) : (
        <path d={mouthPath} fill="none" stroke={OUTLINE} strokeWidth={5} strokeLinecap="round" />
      )}
    </g>
  );
}

export function Character({
  action,
  frame,
  look,
}: Readonly<{ action: CharacterAction; frame: number; look: CharacterLook }>) {
  const pose = poseFor(action, frame);
  return (
    <g transform={`translate(${pose.dx} ${pose.dy})`}>
      {pose.seated ? null : (
        <>
          <Leg x={-34} angle={pose.legs[0]} look={look} />
          <Leg x={34} angle={pose.legs[1]} look={look} />
        </>
      )}
      <Arm x={-76} pose={pose.left} look={look} holding={false} />
      <rect x={-84} y={-456} width={168} height={240} rx={44} fill={look.shirt} stroke={OUTLINE} strokeWidth={4} />
      <rect x={-18} y={-478} width={36} height={30} fill={look.skin} />
      <g transform={`rotate(${pose.headTilt} 0 -470)`}>
        <circle cx={0} cy={-540} r={76} fill={look.skin} stroke={OUTLINE} strokeWidth={4} />
        <Hair look={look} />
        <Face frame={frame} mouth={pose.mouth} />
      </g>
      <Arm x={76} pose={pose.right} look={look} holding={pose.phone} />
    </g>
  );
}
