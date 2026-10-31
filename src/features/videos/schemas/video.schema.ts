import { z } from "zod";

import { DURATION_PRESETS_SEC } from "../domain/duration";
import { illustrationSchema } from "../domain/illustration";
import { shotPlanSchema } from "../domain/shot-plan";
import { PACES } from "../domain/pace";
import { BODY_SCENE_TYPES, VISUAL_VARIANTS } from "../domain/scene-types";
import { MAX_LESSONS_PER_VIDEO, MAX_VIDEOS_PER_REQUEST } from "../domain/video-creation";

export const durationPresetSchema = z.literal(DURATION_PRESETS_SEC, {
  error: `Thời lượng phải là một preset: ${DURATION_PRESETS_SEC.join(", ")} giây.`,
});
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự.`)
    .nullish()
    .transform((value) => (value ? value : null));

// The lengths the user allows; the AI picks the video's length inside them.
export const durationRangeFields = {
  minDurationSec: durationPresetSchema,
  maxDurationSec: durationPresetSchema,
};

// Absent means the default for a new video and "keep the current one" for an update.
export const paceFields = {
  pace: z.enum(PACES, { error: "Nhịp độ phải là Chuẩn, Nhanh hoặc Rất nhanh." }).optional(),
};

export function enforceRange(value: { minDurationSec: number; maxDurationSec: number }, ctx: z.RefinementCtx): void {
  if (value.minDurationSec > value.maxDurationSec) {
    ctx.addIssue({
      code: "custom",
      path: ["minDurationSec"],
      message: "Thời lượng ngắn nhất không được dài hơn thời lượng dài nhất.",
    });
  }
}

export const createVideoSchema = z
  .object({
    bookId: z.string().min(1),
    title: z.string().trim().min(1, "Tiêu đề không được để trống.").max(200, "Tiêu đề tối đa 200 ký tự."),
    description: optionalText(500),
    lessonIds: z
      .array(z.string().min(1))
      .min(1, "Chọn ít nhất một bài học đã duyệt.")
      .max(MAX_LESSONS_PER_VIDEO, `Tối đa ${MAX_LESSONS_PER_VIDEO} bài học cho một video.`),
    ...durationRangeFields,
    ...paceFields,
  })
  .superRefine(enforceRange);

// One video per lesson: each takes its lesson's title and starts without a script, like a video made by hand.
export const createVideosFromLessonsSchema = z
  .object({
    bookId: z.string().min(1),
    lessonIds: z
      .array(z.string().min(1))
      .min(1, "Chọn ít nhất một bài học đã duyệt.")
      .max(MAX_VIDEOS_PER_REQUEST, `Mỗi lần tạo tối đa ${MAX_VIDEOS_PER_REQUEST} video.`)
      .refine((ids) => new Set(ids).size === ids.length, "Mỗi bài học chỉ được chọn một lần."),
    ...durationRangeFields,
    ...paceFields,
  })
  .superRefine(enforceRange);

export const updateVideoSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề không được để trống.").max(200, "Tiêu đề tối đa 200 ký tự."),
    description: optionalText(500),
    platformPreviewMode: z.enum(["TIKTOK", "YOUTUBE_SHORTS", "FACEBOOK_REELS"]).nullable().default(null),
    ...durationRangeFields,
    ...paceFields,
  })
  .superRefine(enforceRange);

export const updateSceneSchema = z.object({
  title: optionalText(120),
  narration: z.string().trim().min(1, "Lời dẫn không được để trống.").max(600, "Lời dẫn tối đa 600 ký tự."),
  onScreenText: z
    .string()
    .trim()
    .min(1, "Chữ trên màn hình không được để trống.")
    .max(120, "Chữ trên màn hình tối đa 120 ký tự."),
  visualVariant: z.enum(VISUAL_VARIANTS),
  // Absent keeps the scene's picture; null goes back to the default one for its type.
  illustration: illustrationSchema.nullable().optional(),
  // Absent keeps the scene's shots (moved onto the new words if the narration changed); null goes back to one shot.
  shots: shotPlanSchema.nullable().optional(),
  hidden: z.boolean().default(false),
});

export const addSceneSchema = z.object({
  type: z.enum(BODY_SCENE_TYPES as [string, ...string[]]),
  afterSceneId: z.string().min(1).nullable().default(null),
});

export const reorderScenesSchema = z.object({
  sceneIds: z.array(z.string().min(1)).min(1),
});

export const selectHookSchema = z.object({
  optionIndex: z.number().int().min(0).max(2),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type CreateVideosFromLessonsInput = z.infer<typeof createVideosFromLessonsSchema>;
export type UpdateVideoInput = z.infer<typeof updateVideoSchema>;
export type UpdateSceneInput = z.infer<typeof updateSceneSchema>;
export type AddSceneInput = z.infer<typeof addSceneSchema>;

export const renderRequestSchema = z.object({
  quality: z.enum(["DRAFT", "FINAL"]),
});

export const previewModeSchema = z.object({
  platformPreviewMode: z.enum(["TIKTOK", "YOUTUBE_SHORTS", "FACEBOOK_REELS"]),
});
