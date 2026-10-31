import { z } from "zod";

import type { TimedWord } from "./caption-pages";
import { CHARACTER_ACTIONS, ILLUSTRATION_SETTINGS, type Illustration } from "./illustration";
import {
  buildSceneShots,
  placePlannedShots,
  SHOT_SIZES,
  type RenderMode,
  type ShotCue,
  type ShotSize,
} from "./scene-shots";
import { PARTNER_ACTIONS, SHOT_MOODS, shotCardSchema, shotPropSchema, type ShotPlan } from "./shot-plan";

// One piece of a scene's picture on its frames, with everything the renderer needs: nothing is carried over or looked up
// at render time.
export const resolvedShotSchema = z.object({
  startFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  size: z.enum(SHOT_SIZES),
  setting: z.enum(ILLUSTRATION_SETTINGS),
  action: z.enum(CHARACTER_ACTIONS),
  mood: z.enum(SHOT_MOODS).nullable(),
  partner: z.enum(PARTNER_ACTIONS).nullable(),
  props: z.array(shotPropSchema),
  tag: z.string().nullable(),
  card: shotCardSchema.nullable(),
});
export type ResolvedShot = z.infer<typeof resolvedShotSchema>;

type Visuals = Omit<ResolvedShot, "startFrame" | "durationInFrames" | "size">;

// Setting and action stay as they were until a shot changes them; mood, partner, props, tag and card belong to one shot.
function visualsOf(plan: ShotPlan, base: Illustration): Visuals[] {
  let { setting, action } = base;
  return plan.map((shot) => {
    setting = shot.setting ?? setting;
    action = shot.action ?? action;
    return {
      setting,
      action,
      mood: shot.mood ?? null,
      partner: shot.partner ?? null,
      props: shot.props ?? [],
      tag: shot.tag ?? null,
      card: shot.card ?? null,
    };
  });
}

// Where each shot's first word is spoken. `words` are the narration's words in order, on the voice's own timings or the
// estimate, so a shot cut lands on its word whichever of the two the scene has.
function cuesOf(plan: ShotPlan, words: readonly TimedWord[], fps: number, sceneFrames: number): ShotCue[] {
  return plan.map((shot) => {
    const word = words[shot.fromWord];
    const frame = word ? Math.round((word.startMs / 1000) * fps) : sceneFrames;
    return { frame: Math.max(0, Math.min(sceneFrames, frame)), size: shot.size, card: shot.card !== undefined };
  });
}

export function resolveSceneShots(input: {
  plan: ShotPlan | null;
  base: Illustration;
  words: readonly TimedWord[];
  pageStarts: readonly number[];
  sceneFrames: number;
  fps: number;
  mode: RenderMode;
  startWith: ShotSize;
}): ResolvedShot[] {
  const { plan, base, words, pageStarts, sceneFrames, fps, mode, startWith } = input;
  if (!plan) {
    const plain: Visuals = { ...base, mood: null, partner: null, props: [], tag: null, card: null };
    return buildSceneShots(pageStarts, sceneFrames, mode, startWith).map((shot) => ({ ...shot, ...plain }));
  }
  const visuals = visualsOf(plan, base);
  return placePlannedShots(cuesOf(plan, words, fps, sceneFrames), pageStarts, sceneFrames, startWith, mode).flatMap(
    ({ plan: index, ...shot }) => {
      const picture = visuals[index];
      return picture ? [{ ...shot, ...picture }] : [];
    },
  );
}
