import { createContext, useContext } from "react";

export interface CharacterLook {
  skin: string;
  hair: string;
  hairStyle: 0 | 1 | 2;
  shirt: string;
  pants: string;
}

const SKINS = ["#f7d4b8", "#eab68e", "#c98d63", "#a8704b"] as const;
const HAIRS = ["#1f2937", "#4a2c1d", "#7c4a2d", "#2b2b2b"] as const;
const SHIRTS = ["#2563eb", "#db2777", "#059669", "#7c3aed", "#ea580c", "#0891b2"] as const;
const PANTS = ["#334155", "#1e3a5f", "#4b5563", "#3f3f46"] as const;
const STYLES = [0, 1, 2] as const;

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}

const pick = <T>(items: readonly T[], seed: number, fallback: T): T => items[seed % items.length] ?? fallback;

// One character per video, the same in every scene, chosen from the video's title so a re-render looks the same.
export function lookFor(seed: string): CharacterLook {
  const value = hash(seed);
  return {
    skin: pick(SKINS, value, SKINS[0]),
    hair: pick(HAIRS, value >>> 3, HAIRS[0]),
    hairStyle: pick(STYLES, value >>> 6, 0),
    shirt: pick(SHIRTS, value >>> 9, SHIRTS[0]),
    pants: pick(PANTS, value >>> 13, PANTS[0]),
  };
}

export const CharacterLookContext = createContext<CharacterLook>(lookFor(""));

export function useCharacterLook(): CharacterLook {
  return useContext(CharacterLookContext);
}
