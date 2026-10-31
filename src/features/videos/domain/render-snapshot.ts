import { createHash } from "node:crypto";

import { z } from "zod";

import { stableStringify } from "@/shared/stable-json";

import { RENDER_TEMPLATE_VERSION, SHORT_VIDEO_COMPOSITION_ID, type CompositionSource } from "./composition-props";
import type { PreflightInput } from "./preflight";
import { illustrationSchema } from "./illustration";
import { PACES } from "./pace";
import { shotPlanSchema } from "./shot-plan";
import { HOOK_VARIANTS, SCENE_TYPES, VISUAL_VARIANTS } from "./scene-types";
import { timedWordsSchema } from "./word-timing";
import { castSnapshotSchema } from "./characters";
import { generationProvenanceSchema } from "./generation-provenance";

export const RENDER_SNAPSHOT_VERSION = "render-snapshot-v1";

// Everything a render is made from, captured when the render is requested. A render reads this and never the live video,
// so an edit made while it waits or runs cannot be mixed into it, and the record of what was rendered stays true.
export const renderSnapshotSchema = z.object({
  cast: castSnapshotSchema.optional(),
  generation: generationProvenanceSchema.optional(),
  schemaVersion: z.literal(RENDER_SNAPSHOT_VERSION),
  templateVersion: z.string().min(1),
  compositionId: z.string().min(1),
  capturedAt: z.iso.datetime(),
  video: z.object({
    id: z.string(),
    title: z.string(),
    bookTitle: z.string(),
    targetDurationSec: z.number().int().positive(),
    // Optional without a default so a snapshot taken before ranges existed keeps its bytes (and its hash).
    minDurationSec: z.number().int().positive().optional(),
    maxDurationSec: z.number().int().positive().optional(),
    // Optional without a default for the same reason: a snapshot taken before paces existed reads as the default pace.
    pace: z.enum(PACES).optional(),
    scriptVersion: z.number().int().positive(),
    // What the script gate saw when the render was requested, so the preflight is judged on the same facts later.
    status: z.string(),
    autoReady: z.boolean(),
  }),
  render: z.object({
    quality: z.enum(["DRAFT", "FINAL"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
  }),
  scenes: z.array(
    z.object({
      id: z.string(),
      order: z.number().int().nonnegative(),
      type: z.enum(SCENE_TYPES),
      title: z.string().nullable(),
      narration: z.string(),
      onScreenText: z.string(),
      visualVariant: z.enum(VISUAL_VARIANTS),
      hookVariant: z.enum(HOOK_VARIANTS).nullable(),
      durationFrames: z.number().int().nonnegative(),
      hidden: z.boolean(),
      audioAssetId: z.string().nullable(),
      // Optional without a default: a snapshot stored before illustrations existed must parse back to the same bytes, or
      // its fingerprint would no longer match and the render would stop being trusted.
      illustration: illustrationSchema.nullable().optional(),
      // The scene's planned shots; absent for a scene with one shot, and for snapshots taken before shots existed.
      shots: shotPlanSchema.optional(),
      // A scenario made up for the video rather than taken from the book. Optional for the same reason as above.
      illustrative: z.boolean().optional(),
    }),
  ),
  // The audio files the scenes use, by the path they were stored under (named by content, so the bytes cannot change).
  audio: z.array(
    z.object({
      assetId: z.string(),
      path: z.string(),
      mimeType: z.string(),
      contentHash: z.string().nullable(),
      durationMs: z.number().int().nullable(),
      leadingSilenceMs: z.number().int().nonnegative(),
      provider: z.string().nullable(),
      // When each word is spoken, for a voice that reported it. Optional without a default so older snapshots keep their hash.
      wordBoundaries: timedWordsSchema.optional(),
    }),
  ),
  lessons: z.array(
    z.object({
      lessonId: z.string(),
      title: z.string(),
      sources: z.array(z.object({ chapterId: z.string(), chapterTitle: z.string(), excerpt: z.string().nullable() })),
    }),
  ),
  // The title, caption and hashtags to post the video with, when a current set existed at request time (archived as
  // publish.txt). Optional without a default, like the fields above, so older snapshots keep their hash.
  publish: z.object({ title: z.string(), caption: z.string(), hashtags: z.array(z.string()) }).optional(),
});

export type RenderSnapshot = z.infer<typeof renderSnapshotSchema>;

export function fingerprintRenderSnapshot(snapshot: RenderSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

// A stored snapshot is only trusted when its shape is valid and its hash still matches what was stored with it.
export function readStoredRenderSnapshot(json: unknown, hash: string | null): RenderSnapshot | null {
  if (json === null || hash === null) return null;
  const parsed = renderSnapshotSchema.safeParse(json);
  return parsed.success && fingerprintRenderSnapshot(parsed.data) === hash ? parsed.data : null;
}

export function currentSnapshotIdentity(): Pick<RenderSnapshot, "schemaVersion" | "templateVersion" | "compositionId"> {
  return {
    schemaVersion: RENDER_SNAPSHOT_VERSION,
    templateVersion: RENDER_TEMPLATE_VERSION,
    compositionId: SHORT_VIDEO_COMPOSITION_ID,
  };
}

export function toCompositionSource(snapshot: RenderSnapshot): CompositionSource {
  const audioById = new Map(snapshot.audio.map((audio) => [audio.assetId, audio]));
  const scenes = [...snapshot.scenes]
    .sort((left, right) => left.order - right.order)
    .map((scene) => ({ ...scene, audio: scene.audioAssetId ? (audioById.get(scene.audioAssetId) ?? null) : null }));
  return {
    title: snapshot.video.title,
    book: { title: snapshot.video.bookTitle },
    pace: snapshot.video.pace,
    scenes,
    ...(snapshot.cast ? { cast: snapshot.cast } : {}),
  };
}

export function toPreflightInput(snapshot: RenderSnapshot): PreflightInput {
  const silenceByAsset = new Map(snapshot.audio.map((audio) => [audio.assetId, audio.leadingSilenceMs]));
  return {
    status: snapshot.video.status,
    autoReady: snapshot.video.autoReady,
    // A render requested before ranges existed was held to its single length, with no minimum.
    maxDurationSec: snapshot.video.maxDurationSec ?? snapshot.video.targetDurationSec,
    minDurationSec: snapshot.video.minDurationSec ?? null,
    scenes: [...snapshot.scenes]
      .sort((left, right) => left.order - right.order)
      .map((scene) => ({
        type: scene.type,
        onScreenText: scene.onScreenText,
        narration: scene.narration,
        durationFrames: scene.durationFrames,
        hidden: scene.hidden,
        audioAssetId: scene.audioAssetId,
        audio: scene.audioAssetId ? { leadingSilenceMs: silenceByAsset.get(scene.audioAssetId) ?? 0 } : null,
      })),
  };
}
