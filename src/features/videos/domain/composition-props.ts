import { z } from "zod";

import { buildCaptionCues } from "./captions";
import { effectiveSceneFrames, VIDEO_FPS } from "./duration";
import { SCENE_TYPE_LABELS, SCENE_TYPES, VISUAL_VARIANTS, type SceneType, type VisualVariant } from "./scene-types";

export const compositionSceneSchema = z.object({
  id: z.string(),
  type: z.enum(SCENE_TYPES),
  layout: z.enum(VISUAL_VARIANTS),
  label: z.string(),
  onScreenText: z.string().min(1),
  captions: z.array(z.object({ text: z.string(), startFrame: z.number().int(), endFrame: z.number().int() })),
  durationInFrames: z.number().int().positive(),
  audioSrc: z.string().nullable(),
});

export const shortVideoPropsSchema = z.object({
  title: z.string(),
  bookTitle: z.string(),
  showCaptions: z.boolean(),
  scenes: z.array(compositionSceneSchema).min(1),
});

export type CompositionScene = z.infer<typeof compositionSceneSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoPropsSchema>;

export interface CompositionSource {
  title: string;
  book: { title: string };
  scenes: readonly {
    id: string;
    type: SceneType;
    visualVariant: VisualVariant;
    narration: string;
    onScreenText: string;
    durationFrames: number;
    hidden: boolean;
    audioAssetId: string | null;
  }[];
}

export const SHORT_VIDEO_COMPOSITION_ID = "ShortVideo";

// Recorded in every render snapshot. Bump it whenever a change to the Remotion composition or its scenes would make the
// same props look different, so an old render can be told apart from what the code produces today.
export const RENDER_TEMPLATE_VERSION = "short-video-template-v1";

// Single mapping used by the browser Player and the worker render, so preview and output never diverge.
export function toCompositionProps(
  source: CompositionSource,
  audioUrl: (assetId: string) => string | null = () => null,
): ShortVideoProps {
  return {
    title: source.title,
    bookTitle: source.book.title,
    showCaptions: true,
    scenes: source.scenes
      .filter((scene) => !scene.hidden)
      .map((scene) => {
        const durationInFrames = effectiveSceneFrames(scene.durationFrames);
        return {
          id: scene.id,
          type: scene.type,
          layout: scene.visualVariant,
          label: SCENE_TYPE_LABELS[scene.type],
          onScreenText: scene.onScreenText,
          captions: buildCaptionCues(scene.narration, durationInFrames),
          durationInFrames,
          audioSrc: scene.audioAssetId ? audioUrl(scene.audioAssetId) : null,
        };
      }),
  };
}

export function totalFrames(props: Pick<ShortVideoProps, "scenes">): number {
  return props.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) || VIDEO_FPS;
}
