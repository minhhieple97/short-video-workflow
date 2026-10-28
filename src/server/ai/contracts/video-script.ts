import { z } from "zod";

import { DURATION_PRESETS_SEC, MAX_STORY_SCENES } from "@/features/videos/domain/duration";
import { lessonSnapshotSchema } from "@/features/videos/domain/lesson-snapshot";
import { BODY_SCENE_TYPES, HOOK_VARIANTS, VISUAL_VARIANTS } from "@/features/videos/domain/scene-types";

const narration = z.string().trim().min(1).max(600);
const onScreenText = z.string().trim().min(1).max(120);

export const hookOptionSchema = z.object({
  variant: z.enum(HOOK_VARIANTS),
  narration: narration.max(120),
  onScreenText: onScreenText.max(60),
  visualVariant: z.enum(VISUAL_VARIANTS),
});

export const storyboardSceneSchema = z.object({
  type: z.enum(BODY_SCENE_TYPES as [string, ...string[]]),
  title: z.string().trim().max(120).optional(),
  narration,
  onScreenText,
  visualVariant: z.enum(VISUAL_VARIANTS),
});

export const videoScriptInputSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  targetDurationSec: z.literal(DURATION_PRESETS_SEC),
  videoProfile: z.literal("SHORT_VERTICAL"),
  lessons: z.array(lessonSnapshotSchema).min(1),
  promptVersion: z.string(),
});

export const videoScriptOutputSchema = z.object({
  videoId: z.string(),
  hookOptions: z.array(hookOptionSchema).min(2).max(3),
  // A five-minute video tells each part of the story in several scenes.
  scenes: z.array(storyboardSceneSchema).min(1).max(MAX_STORY_SCENES),
});

export const sceneRegenerationInputSchema = z.object({
  videoId: z.string(),
  sceneId: z.string(),
  attempt: z.number().int().nonnegative(),
  targetDurationSec: z.number().int(),
  lessons: z.array(lessonSnapshotSchema).min(1),
  scene: storyboardSceneSchema,
  promptVersion: z.string(),
});

export const sceneRegenerationOutputSchema = z.object({
  sceneId: z.string(),
  scene: storyboardSceneSchema,
});

export type HookOption = z.infer<typeof hookOptionSchema>;
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export type VideoScriptInput = z.infer<typeof videoScriptInputSchema>;
export type VideoScriptOutput = z.infer<typeof videoScriptOutputSchema>;
export type SceneRegenerationInput = z.infer<typeof sceneRegenerationInputSchema>;
export type SceneRegenerationOutput = z.infer<typeof sceneRegenerationOutputSchema>;
