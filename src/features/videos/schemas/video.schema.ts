import { z } from "zod";

import { BODY_SCENE_TYPES, VISUAL_VARIANTS } from "../domain/scene-types";

const durationPreset = z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự.`)
    .nullish()
    .transform((value) => (value ? value : null));

const EXTENDED_RULE = "Preset 90 giây chỉ dùng khi chọn rõ “Extended Short”.";

export const durationFields = {
  targetDurationSec: durationPreset.default(60),
  extended: z.boolean().default(false),
};

export function enforceExtended(value: { targetDurationSec: number; extended: boolean }, ctx: z.RefinementCtx): void {
  if ((value.targetDurationSec === 90) !== value.extended) {
    ctx.addIssue({ code: "custom", path: ["targetDurationSec"], message: EXTENDED_RULE });
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
      .max(5, "Tối đa 5 bài học cho một video."),
    ...durationFields,
  })
  .superRefine(enforceExtended);

export const updateVideoSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề không được để trống.").max(200, "Tiêu đề tối đa 200 ký tự."),
    description: optionalText(500),
    platformPreviewMode: z.enum(["TIKTOK", "YOUTUBE_SHORTS", "FACEBOOK_REELS"]).nullable().default(null),
    ...durationFields,
  })
  .superRefine(enforceExtended);

export const updateSceneSchema = z.object({
  title: optionalText(120),
  narration: z.string().trim().min(1, "Lời dẫn không được để trống.").max(600, "Lời dẫn tối đa 600 ký tự."),
  onScreenText: z
    .string()
    .trim()
    .min(1, "Chữ trên màn hình không được để trống.")
    .max(120, "Chữ trên màn hình tối đa 120 ký tự."),
  visualVariant: z.enum(VISUAL_VARIANTS),
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
export type UpdateVideoInput = z.infer<typeof updateVideoSchema>;
export type UpdateSceneInput = z.infer<typeof updateSceneSchema>;
export type AddSceneInput = z.infer<typeof addSceneSchema>;

export const renderRequestSchema = z.object({
  quality: z.enum(["DRAFT", "FINAL"]),
});

export const previewModeSchema = z.object({
  platformPreviewMode: z.enum(["TIKTOK", "YOUTUBE_SHORTS", "FACEBOOK_REELS"]),
});
