import { z } from "zod";

import { buildCaptionPages } from "./caption-pages";
import { effectiveSceneFrames, VIDEO_FPS } from "./duration";
import { DEFAULT_ILLUSTRATION, illustrationSchema, type Illustration } from "./illustration";
import { paceProfile, toPace } from "./pace";
import { alternateShotSize, buildSceneShots, renderModeFor, SHOT_SIZES, type ShotSize } from "./scene-shots";
import { SCENE_TYPE_LABELS, SCENE_TYPES, VISUAL_VARIANTS, type SceneType, type VisualVariant } from "./scene-types";
import { estimateWordTimings } from "./word-timing";

const captionWordSchema = z.object({
  text: z.string(),
  startFrame: z.number().int(),
  endFrame: z.number().int(),
});

export const compositionSceneSchema = z.object({
  id: z.string(),
  type: z.enum(SCENE_TYPES),
  layout: z.enum(VISUAL_VARIANTS),
  label: z.string(),
  onScreenText: z.string().min(1),
  durationInFrames: z.number().int().positive(),
  audioSrc: z.string().nullable(),
  illustration: illustrationSchema,
  captionPages: z.array(
    z.object({
      startFrame: z.number().int(),
      endFrame: z.number().int(),
      lines: z.array(z.array(captionWordSchema)),
    }),
  ),
  // True only when the word timings come from the voice itself; estimated timings page the captions but never light up
  // the spoken word.
  karaoke: z.boolean(),
  shots: z
    .array(
      z.object({
        startFrame: z.number().int().nonnegative(),
        durationInFrames: z.number().int().positive(),
        size: z.enum(SHOT_SIZES),
      }),
    )
    .min(1),
});

export const shortVideoPropsSchema = z.object({
  title: z.string(),
  bookTitle: z.string(),
  showCaptions: z.boolean(),
  // How much faster scene animation plays (1 = as designed); only the pictures speed up, never the voice or the captions.
  paceFactor: z.number().min(0.5).max(2).default(1),
  scenes: z.array(compositionSceneSchema).min(1),
});

export type CompositionScene = z.infer<typeof compositionSceneSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoPropsSchema>;

export interface CompositionSource {
  title: string;
  book: { title: string };
  // The video's pace; absent for a render captured before paces existed, which reads as the default.
  pace?: string;
  scenes: readonly {
    id: string;
    type: SceneType;
    visualVariant: VisualVariant;
    narration: string;
    onScreenText: string;
    durationFrames: number;
    hidden: boolean;
    audioAssetId: string | null;
    // Absent for scenes made before illustrations existed; they get the default picture for their type.
    illustration?: Illustration | null;
    // Where the voice sits in its clip, to spread the caption words over the spoken part.
    audio?: { durationMs: number | null; leadingSilenceMs: number } | null;
  }[];
}

export const SHORT_VIDEO_COMPOSITION_ID = "ShortVideo";

// Recorded in every render snapshot. Bump it whenever a change to the Remotion composition or its scenes would make the
// same props look different, so an old render can be told apart from what the code produces today.
export const RENDER_TEMPLATE_VERSION = "short-video-template-v5";

const framesToMs = (frames: number) => Math.round((frames / VIDEO_FPS) * 1000);

// The part of the scene the narration is spoken in: the voice clip without its leading silence, or most of the scene
// when there is no voice yet.
function spokenSpan(source: CompositionSource["scenes"][number], durationInFrames: number) {
  const sceneMs = framesToMs(durationInFrames);
  if (!source.audio) return { startMs: 0, endMs: Math.round(sceneMs * 0.92) };
  return {
    startMs: source.audio.leadingSilenceMs,
    endMs: Math.min(sceneMs, source.audio.durationMs ?? sceneMs),
  };
}

// Single mapping used by the browser Player and the worker render, so preview and output never diverge.
export function toCompositionProps(
  source: CompositionSource,
  audioUrl: (assetId: string) => string | null = () => null,
): ShortVideoProps {
  const visible = source.scenes.filter((scene) => !scene.hidden);
  let previous: { setting: string; stage: boolean; lastSize: ShotSize } | null = null;
  const scenes = visible.map((scene) => {
    const durationInFrames = effectiveSceneFrames(scene.durationFrames);
    const illustration = scene.illustration ?? DEFAULT_ILLUSTRATION[scene.type];
    const mode = renderModeFor(scene.visualVariant);
    const captionPages = buildCaptionPages(
      estimateWordTimings(scene.narration, spokenSpan(scene, durationInFrames)),
      VIDEO_FPS,
      durationInFrames,
    );
    // A scene that cuts straight on from the same place opens on the other shot size, so the cut reads as a cut.
    const continues = previous?.stage === true && mode === "STAGE" && previous.setting === illustration.setting;
    const startWith: ShotSize =
      continues && previous ? alternateShotSize(previous.lastSize) : scene.type === "HOOK" ? "MEDIUM" : "WIDE";
    const shots = buildSceneShots(
      captionPages.map((page) => page.startFrame),
      durationInFrames,
      mode,
      startWith,
    );
    previous = { setting: illustration.setting, stage: mode === "STAGE", lastSize: shots.at(-1)?.size ?? startWith };
    return {
      id: scene.id,
      type: scene.type,
      layout: scene.visualVariant,
      label: SCENE_TYPE_LABELS[scene.type],
      onScreenText: scene.onScreenText,
      durationInFrames,
      audioSrc: scene.audioAssetId ? audioUrl(scene.audioAssetId) : null,
      illustration,
      captionPages,
      karaoke: false,
      shots,
    };
  });
  return {
    title: source.title,
    bookTitle: source.book.title,
    showCaptions: true,
    paceFactor: paceProfile(toPace(source.pace)).animationFactor,
    scenes,
  };
}

export function totalFrames(props: Pick<ShortVideoProps, "scenes">): number {
  return props.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) || VIDEO_FPS;
}
