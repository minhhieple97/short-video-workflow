import { z } from "zod";

import { DURATION_PRESETS_SEC, MAX_STORY_SCENES } from "@/features/videos/domain/duration";
import { lessonSnapshotSchema } from "@/features/videos/domain/lesson-snapshot";
import { PACES } from "@/features/videos/domain/pace";
import { scriptSourcePackSchema, sourceReferencesProblem } from "@/features/videos/domain/script-source-pack";
import { STORY_ANGLES } from "@/features/videos/domain/story-angle";
import { captureCast, castSnapshotSchema } from "@/features/videos/domain/characters";
import { aiSettingsSchema } from "@/features/settings/domain/ai-settings";
import { hookOptionSchema } from "@/server/ai/contracts/video-script";
import { publishBookSchema } from "@/server/ai/contracts/publish-metadata";
import { scriptDraftBeatSchema, scriptDraftSchema } from "@/server/script-studio/script-studio-contracts";
import { AppError } from "@/shared/errors";

export const SCRIPT_DRAFT_PROMPT_VERSION = "script-draft-v1";
export const generationInputSchema = z.object({
  aiMode: z.enum(["mock", "cli-task", "cli-auto"]),
  videoId: z.string(),
  title: z.string(),
  bookId: z.string(),
  book: publishBookSchema,
  lessons: z.array(lessonSnapshotSchema).min(1),
  minDurationSec: z.literal(DURATION_PRESETS_SEC),
  maxDurationSec: z.literal(DURATION_PRESETS_SEC),
  pace: z.enum(PACES),
  storyAngle: z.enum(STORY_ANGLES),
  draftPromptVersion: z.string(),
  scenePromptVersion: z.string(),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
const sourceReferenceSchema = z.object({
  sourceId: z.string().min(1),
  page: z.number().int().positive().nullable(),
  text: z.string().trim().min(8),
});
export const storyDraftSchema = scriptDraftSchema.safeExtend({
  schemaVersion: z.literal("story-draft-v2"),
  lessonIds: z.array(z.string()).min(1),
  cast: z.array(z.object({ characterId: z.string().min(1), role: z.string().trim().min(1).max(160) })).min(1),
  hookOptions: z.array(hookOptionSchema).min(2).max(3),
  logic: z.object({
    question: z.string().trim().min(1).max(300),
    oldChoiceMotive: z.string().trim().min(1).max(400),
    mechanism: z.string().trim().min(1).max(600),
    changedActions: z.array(z.string().trim().min(1).max(250)).min(1).max(5),
    observableResult: z.string().trim().min(1).max(400),
    limits: z.string().trim().min(1).max(400),
    sourceIds: z.array(z.string()).min(1),
  }),
  beats: z
    .array(
      scriptDraftBeatSchema.extend({
        characterIds: z.array(z.string()),
        sourceExcerpts: z.array(sourceReferenceSchema),
      }),
    )
    .min(1)
    .max(MAX_STORY_SCENES),
});
export type StoryDraft = z.infer<typeof storyDraftSchema>;
export const draftRequestSchema = z.object({
  input: generationInputSchema,
  settings: aiSettingsSchema,
  sourcePack: scriptSourcePackSchema,
  revisionNote: z.string().nullable(),
  fixedCast: castSnapshotSchema.optional(),
});
export type DraftRequest = z.infer<typeof draftRequestSchema>;

export function validateStoryDraft(candidate: unknown, request: DraftRequest): StoryDraft {
  const draft = storyDraftSchema.parse(candidate);
  const invalid = (message: string): never => {
    throw new AppError("SCRIPT_DRAFT_INVALID", message, 422);
  };
  if (
    draft.lessonId !== request.input.lessons[0]?.lessonId ||
    new Set(draft.lessonIds).size !== request.input.lessons.length ||
    request.input.lessons.some((lesson) => !draft.lessonIds.includes(lesson.lessonId))
  )
    invalid("Bản thảo không khớp các bài học đã chọn.");
  if (draft.targetDurationSec < request.input.minDurationSec || draft.targetDurationSec > request.input.maxDurationSec)
    invalid("Thời lượng bản thảo nằm ngoài khoảng đã chọn.");
  try {
    captureCast(request.settings.characters, draft.cast);
  } catch {
    invalid("Bản thảo chọn nhân vật không thuộc thư viện hoặc vượt giới hạn.");
  }
  const castIds = new Set(draft.cast.map((choice) => choice.characterId));
  if (
    request.fixedCast &&
    (request.fixedCast.profiles.length !== castIds.size ||
      request.fixedCast.profiles.some((profile) => !castIds.has(profile.id)))
  )
    invalid("Lần sửa phải giữ dàn nhân vật đã chọn.");
  if (draft.beats.some((beat) => beat.characterIds.some((id) => !castIds.has(id))))
    invalid("Cảnh có nhân vật không thuộc dàn nhân vật đã chọn.");
  if (draft.beats.some((beat) => ["SITUATION", "MISTAKE", "RESOLUTION"].includes(beat.beat) && !beat.illustrative))
    invalid("Tình huống, sai lầm và cách giải quyết của nhân vật hư cấu phải được đánh dấu minh họa.");
  const sourceIds = new Set(request.sourcePack.sources.map((source) => source.id));
  if (draft.logic.sourceIds.some((id) => !sourceIds.has(id)))
    invalid("Nguyên lý tham chiếu nguồn không có trong gói nguồn.");
  const references = draft.beats.flatMap((beat) => beat.sourceExcerpts);
  if (!references.length) invalid("Bản thảo thiếu trích đoạn nguồn kiểm chứng.");
  if (draft.beats.some((beat) => beat.beat === "LESSON" && beat.sourceExcerpts.length === 0))
    invalid("Nhịp giải thích nguyên lý phải có trích đoạn nguồn.");
  const problem = sourceReferencesProblem(request.sourcePack, references);
  if (problem) invalid(problem);
  if (draft.beats[0]?.narration !== draft.hookOptions[0]?.narration) invalid("Hook đầu tiên không khớp lời kể mở đầu.");
  return draft;
}
