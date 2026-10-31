import type { CharacterAction } from "@/features/videos/domain/illustration";
import type { ShotSize } from "@/features/videos/domain/scene-shots";
import type { PartnerAction, ShotMood } from "@/features/videos/domain/shot-plan";

import type { PeepBodyName, PeepFaceName, PeepHairName, PeepLook } from "../peeps/peep";
import { INK, PAPER } from "../theme/tokens";

export type CastExtra = "THOUGHT" | "SPEECH" | "IDEA" | "SWEAT" | "CONFETTI";

// The two people a video can show: its main character and the one supporting character it may bring in.
export interface Cast {
  main: PeepLook;
  partner: PeepLook;
}

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

export const MOOD_FACES: Record<ShotMood, PeepFaceName> = {
  CALM: "Calm",
  HAPPY: "Smile",
  JOYFUL: "SmileBig",
  WORRIED: "Concerned",
  SCARED: "ConcernedFear",
  ANGRY: "Angry",
  SURPRISED: "Awe",
  TIRED: "Tired",
  FOCUSED: "Driven",
  DOUBTFUL: "Suspicious",
  SAD: "Solemn",
};

// A shot's mood, when it names one, replaces the face the action would give.
export function faceFor(pose: CastPose, size: ShotSize, mood: ShotMood | null = null): PeepFaceName {
  if (mood) return MOOD_FACES[mood];
  return size === "CLOSE" ? pose.closeFace : pose.face;
}

// Beside a supporting character both stand whole on the ground, so the main character's action takes a standing pose.
export const STANDING_POSES: Record<CharacterAction, CastPose> = {
  THINKING: { body: "CrossedArmsWB", face: "Blank", closeFace: "Suspicious", full: true },
  WORRIED: { body: "RestingWB", face: "Concerned", closeFace: "ConcernedFear", full: true },
  WORKING: { body: "RestingWB", face: "Driven", closeFace: "Serious", full: true },
  TALKING: { body: "PointingFingerWB", face: "Explaining", closeFace: "Explaining", full: true },
  WALKING: { body: "WalkingWB", face: "Calm", closeFace: "Smile", full: true, walks: true },
  PHONE: { body: "RestingWB", face: "Calm", closeFace: "Blank", full: true },
  IDEA: { body: "PointingFingerWB", face: "Awe", closeFace: "Awe", full: true },
  CELEBRATING: { body: "RoboDanceWB", face: "SmileBig", closeFace: "SmileLol", full: true },
};

// The supporting character wears the dark outfit family so it never reads as the main character.
export const PARTNER_POSES: Record<PartnerAction, CastPose> = {
  LISTENING: { body: "RestingBW", face: "Calm", closeFace: "Smile", full: true },
  TALKING: { body: "RestingBW", face: "Explaining", closeFace: "Explaining", full: true },
  POINTING: { body: "PointingFingerBW", face: "Driven", closeFace: "Driven", full: true },
  DOUBTING: { body: "CrossedArmsBW", face: "Suspicious", closeFace: "Suspicious", full: true },
  CELEBRATING: { body: "RoboDanceBW", face: "SmileBig", closeFace: "SmileLol", full: true },
  WALKING: { body: "WalkingBW", face: "Calm", closeFace: "Smile", full: true, walks: true },
};

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

// The supporting character of a video: another hair style than the main one, chosen from the same seed.
export function partnerLook(seed: string, main: PeepLook): PeepLook {
  const value = hash(`${seed}:partner`);
  const taken = HAIR.indexOf(main.hair);
  const hair = HAIR[(taken + 3 + (value % (HAIR.length - 4))) % HAIR.length] ?? "Short";
  return {
    hair,
    accessory: main.accessory ? undefined : (value >>> 8) % 3 === 0 ? "GlassRoundThick" : undefined,
    facialHair: (value >>> 12) % 3 === 0 ? "MoustacheThin" : undefined,
    line: INK,
    fill: PAPER,
  };
}

export function castFor(seed: string): Cast {
  const main = mainLook(seed);
  return { main, partner: partnerLook(seed, main) };
}
