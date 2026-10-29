import { z } from "zod";

import { DURATION_PRESETS_SEC, MAX_STORY_SCENES } from "@/features/videos/domain/duration";
import { illustrationSchema } from "@/features/videos/domain/illustration";
import { lessonSnapshotSchema } from "@/features/videos/domain/lesson-snapshot";
import { PACES } from "@/features/videos/domain/pace";
import { BODY_SCENE_TYPES, HOOK_VARIANTS, VISUAL_VARIANTS } from "@/features/videos/domain/scene-types";

import { publishBookSchema, publishMetadataDraftSchema } from "./publish-metadata";

const narration = z.string().trim().min(1).max(600);
const onScreenText = z.string().trim().min(1).max(120);

export const hookOptionSchema = z.object({
  variant: z.enum(HOOK_VARIANTS),
  narration: narration.max(120),
  onScreenText: onScreenText.max(60),
  visualVariant: z.enum(VISUAL_VARIANTS),
  // Optional: without it the scene gets the default cartoon for its type.
  illustration: illustrationSchema.optional(),
});

export const storyboardSceneSchema = z.object({
  type: z.enum(BODY_SCENE_TYPES as [string, ...string[]]),
  title: z.string().trim().max(120).optional(),
  narration,
  onScreenText,
  visualVariant: z.enum(VISUAL_VARIANTS),
  illustration: illustrationSchema.optional(),
});

const durationPreset = z.literal(DURATION_PRESETS_SEC);

export const videoScriptInputSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  // The lengths the user allows; the AI proposes one of them with the script.
  minDurationSec: durationPreset,
  maxDurationSec: durationPreset,
  // How fast the narration will be voiced, so the script is written to that many words for its length.
  pace: z.enum(PACES).default("STANDARD"),
  videoProfile: z.literal("SHORT_VERTICAL"),
  book: publishBookSchema,
  lessons: z.array(lessonSnapshotSchema).min(1),
  promptVersion: z.string(),
});

export const videoScriptOutputSchema = z.object({
  videoId: z.string(),
  targetDurationSec: durationPreset,
  durationReason: z.string().trim().min(1).max(200),
  hookOptions: z.array(hookOptionSchema).min(2).max(3),
  // A five-minute video tells each part of the story in several scenes.
  scenes: z.array(storyboardSceneSchema).min(1).max(MAX_STORY_SCENES),
  // Optional and loosely typed so that a caption breaking a rule is dropped on its own instead of failing the script.
  publish: publishMetadataDraftSchema.optional(),
});

export const sceneRegenerationInputSchema = z.object({
  videoId: z.string(),
  sceneId: z.string(),
  attempt: z.number().int().nonnegative(),
  targetDurationSec: z.number().int(),
  pace: z.enum(PACES).default("STANDARD"),
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
