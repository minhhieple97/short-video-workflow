import type { CharacterAction } from "@/features/videos/domain/illustration";
import type { ShotSize } from "@/features/videos/domain/scene-shots";

import type { PeepBodyName, PeepFaceName, PeepHairName, PeepLook } from "../peeps/peep";
import { INK, PAPER } from "../theme/tokens";

export type CastExtra = "THOUGHT" | "SPEECH" | "IDEA" | "SWEAT" | "CONFETTI";

export interface CastPose {
  body: PeepBodyName;
  face: PeepFaceName;
  // A stronger face for a close shot of the same moment.
  closeFace: PeepFaceName;
  // Drawn whole on the ground instead of half-hidden behind the set's furniture.
  full: boolean;
  extra?: CastExtra;
  walks?: boolean;
}

// What each of the fixed actions looks like with Open Peeps. The main character keeps the light-top outfit family in every
// pose, so changing pose never reads as a different person.
export const ACTION_POSES: Record<CharacterAction, CastPose> = {
  THINKING: { body: "Shirt", face: "Blank", closeFace: "Suspicious", full: false, extra: "THOUGHT" },
  WORRIED: { body: "Shirt", face: "Concerned", closeFace: "ConcernedFear", full: false, extra: "SWEAT" },
  WORKING: { body: "Geek", face: "Driven", closeFace: "Serious", full: false },
  TALKING: { body: "Explaining", face: "Explaining", closeFace: "Explaining", full: false, extra: "SPEECH" },
  WALKING: { body: "WalkingWB", face: "Calm", closeFace: "Smile", full: true, walks: true },
  PHONE: { body: "Device", face: "Calm", closeFace: "Blank", full: false },
  IDEA: { body: "Shirt", face: "Awe", closeFace: "Awe", full: false, extra: "IDEA" },
  CELEBRATING: { body: "Shirt", face: "SmileBig", closeFace: "SmileLol", full: false, extra: "CONFETTI" },
};

export function faceFor(pose: CastPose, size: ShotSize): PeepFaceName {
  return size === "CLOSE" ? pose.closeFace : pose.face;
}

const HAIR: readonly PeepHairName[] = [
  "ShortMessy",
  "Short",
  "ShortVolumed",
  "Pomp",
  "Medium",
  "MediumShort",
  "MediumStraight",
  "Long",
  "LongBangs",
  "Bun",
  "BangsFilled",
];

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}

// One main character per video, the same in every scene, chosen from the video's title so a re-render looks the same.
export function mainLook(seed: string): PeepLook {
  const value = hash(seed);
  return {
    hair: HAIR[value % HAIR.length] ?? "ShortMessy",
    accessory: (value >>> 8) % 4 === 0 ? "GlassRound" : undefined,
    line: INK,
    fill: PAPER,
  };
}
