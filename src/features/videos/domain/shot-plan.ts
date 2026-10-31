import { z } from "zod";

import { CHARACTER_ACTIONS, ILLUSTRATION_SETTINGS } from "./illustration";
import { PROP_IDS } from "./props";
import { SHOT_SIZES } from "./scene-shots";
import { spokenTokens, wordKey } from "./word-timing";

// A scene's picture planned shot by shot under its one voice-over. Each shot starts on a word of the narration, counted
// the way captions count words, so editing the picture never touches the voice. The place and the pose carry over to the
// next shots until a shot changes them; everything else (mood, partner, props, words, camera, card) belongs to its shot.

export const MAX_SHOTS_PER_SCENE = 6;
// The hook lasts at most four seconds, so it has room for two shots at most.
export const MAX_HOOK_SHOTS = 2;
export const MAX_SHOT_PROPS = 2;
export const MAX_VISIBLE_CHARACTERS = 2;
export const shotActorsSchema = z
  .array(z.object({ characterId: z.string().min(1).max(60), action: z.enum(CHARACTER_ACTIONS) }))
  .max(MAX_VISIBLE_CHARACTERS)
  .refine(
    (actors) => new Set(actors.map((actor) => actor.characterId)).size === actors.length,
    "Một người không được xuất hiện hai lần trong cùng shot.",
  );
export const SHOT_TAG_MAX = 24;
export const PROP_LABEL_MAX = 18;

export const SHOT_MOODS = [
  "CALM",
  "HAPPY",
  "JOYFUL",
  "WORRIED",
  "SCARED",
  "ANGRY",
  "SURPRISED",
  "TIRED",
  "FOCUSED",
  "DOUBTFUL",
  "SAD",
] as const;
export type ShotMood = (typeof SHOT_MOODS)[number];

export const SHOT_MOOD_LABELS: Record<ShotMood, string> = {
  CALM: "Bình thản",
  HAPPY: "Vui vẻ",
  JOYFUL: "Hớn hở",
  WORRIED: "Lo lắng",
  SCARED: "Sợ hãi",
  ANGRY: "Bực bội",
  SURPRISED: "Ngạc nhiên",
  TIRED: "Mệt mỏi",
  FOCUSED: "Tập trung",
  DOUBTFUL: "Nghi ngờ",
  SAD: "Buồn",
};

// What the supporting character does beside the main one.
export const PARTNER_ACTIONS = ["LISTENING", "TALKING", "POINTING", "DOUBTING", "CELEBRATING", "WALKING"] as const;
export type PartnerAction = (typeof PARTNER_ACTIONS)[number];

export const PARTNER_ACTION_LABELS: Record<PartnerAction, string> = {
  LISTENING: "Lắng nghe",
  TALKING: "Nói chuyện",
  POINTING: "Chỉ tay góp ý",
  DOUBTING: "Khoanh tay nghi ngờ",
  CELEBRATING: "Ăn mừng",
  WALKING: "Đi cùng",
};

// Full-screen text cards that replace the cartoon for one shot.
export const CARD_STYLES = ["PUNCH", "LIST", "VERSUS", "NUMBER", "QUOTE"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
  PUNCH: "Câu chốt",
  LIST: "Danh sách",
  VERSUS: "Sai / đúng",
  NUMBER: "Con số",
  QUOTE: "Trích sách",
};

// Lines each card style holds and how long each may be (the first line of a NUMBER card is the number itself).
export const CARD_LIMITS: Record<CardStyle, { minLines: number; maxLines: number; lineChars: number }> = {
  PUNCH: { minLines: 1, maxLines: 3, lineChars: 40 },
  LIST: { minLines: 2, maxLines: 4, lineChars: 40 },
  VERSUS: { minLines: 2, maxLines: 2, lineChars: 48 },
  NUMBER: { minLines: 1, maxLines: 2, lineChars: 48 },
  QUOTE: { minLines: 1, maxLines: 1, lineChars: 160 },
};
const NUMBER_VALUE_CHARS = 12;

export interface ShotCard {
  style: CardStyle;
  lines: string[];
}

export function cardProblem(card: ShotCard): string | null {
  const limits = CARD_LIMITS[card.style];
  const label = CARD_STYLE_LABELS[card.style];
  if (card.lines.length < limits.minLines || card.lines.length > limits.maxLines) {
    return limits.minLines === limits.maxLines
      ? `Thẻ "${label}" cần đúng ${limits.minLines} dòng.`
      : `Thẻ "${label}" cần ${limits.minLines}–${limits.maxLines} dòng.`;
  }
  if (card.lines.some((line) => line.trim().length === 0 || line.length > limits.lineChars)) {
    return `Mỗi dòng của thẻ "${label}" tối đa ${limits.lineChars} ký tự.`;
  }
  const [value = ""] = card.lines;
  if (card.style === "NUMBER" && (!/\d/.test(value) || value.length > NUMBER_VALUE_CHARS)) {
    return `Dòng đầu của thẻ "${label}" phải là một con số ngắn (tối đa ${NUMBER_VALUE_CHARS} ký tự).`;
  }
  return null;
}

export const shotPropSchema = z.object({
  id: z.enum(PROP_IDS),
  label: z.string().trim().min(1).max(PROP_LABEL_MAX).optional(),
});

export const shotCardSchema = z
  .object({ style: z.enum(CARD_STYLES), lines: z.array(z.string().trim().min(1).max(160)).min(1).max(4) })
  .superRefine((card, context) => {
    const problem = cardProblem(card);
    if (problem) context.addIssue({ code: "custom", path: ["lines"], message: problem });
  });

export const plannedShotSchema = z.object({
  fromWord: z.number().int().nonnegative(),
  setting: z.enum(ILLUSTRATION_SETTINGS).optional(),
  action: z.enum(CHARACTER_ACTIONS).optional(),
  mood: z.enum(SHOT_MOODS).optional(),
  size: z.enum(SHOT_SIZES).optional(),
  partner: z.enum(PARTNER_ACTIONS).optional(),
  props: z.array(shotPropSchema).max(MAX_SHOT_PROPS).optional(),
  tag: z.string().trim().min(1).max(SHOT_TAG_MAX).optional(),
  card: shotCardSchema.optional(),
  actors: shotActorsSchema.optional(),
});

export const shotPlanSchema = z
  .array(plannedShotSchema)
  .min(1)
  .max(MAX_SHOTS_PER_SCENE)
  .superRefine((shots, context) => {
    if (shots[0]?.fromWord !== 0) {
      context.addIssue({ code: "custom", path: [0, "fromWord"], message: "Shot đầu tiên phải bắt đầu từ chữ đầu." });
    }
    shots.forEach((shot, index) => {
      const previous = shots[index - 1];
      if (previous && shot.fromWord <= previous.fromWord) {
        context.addIssue({
          code: "custom",
          path: [index, "fromWord"],
          message: "Các shot phải bắt đầu theo thứ tự lời dẫn.",
        });
      }
    });
  });

export type PlannedShot = z.infer<typeof plannedShotSchema>;
export type ShotPlan = z.infer<typeof shotPlanSchema>;
export type ShotProp = z.infer<typeof shotPropSchema>;

// What a model writes: the first words of the narration where a shot starts instead of a word count, which models get
// wrong. Every field is optional and a broken one is dropped on its own, so a bad prop or card never fails a script.
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

export const aiShotSchema = z.object({
  from: lenient(z.string().trim().max(80)),
  actors: shotActorsSchema.optional(),
  setting: lenient(z.enum(ILLUSTRATION_SETTINGS)),
  action: lenient(z.enum(CHARACTER_ACTIONS)),
  mood: lenient(z.enum(SHOT_MOODS)),
  size: lenient(z.enum(SHOT_SIZES)),
  partner: lenient(z.enum(PARTNER_ACTIONS)),
  props: lenient(
    z
      .array(z.object({ id: z.enum(PROP_IDS), label: lenient(z.string().trim().min(1).max(PROP_LABEL_MAX)) }))
      .max(MAX_SHOT_PROPS),
  ),
  tag: lenient(z.string().trim().min(1).max(SHOT_TAG_MAX)),
  card: lenient(
    z.object({ style: z.enum(CARD_STYLES), lines: z.array(z.string().trim().min(1).max(160)).min(1).max(4) }),
  ),
});
export type AiShot = z.infer<typeof aiShotSchema>;

export const aiShotListSchema = (maxShots: number) => lenient(z.array(aiShotSchema).min(1).max(maxShots));

// A card that does not fit its style is kept as a punchline when its lines allow it, otherwise dropped (the shot then
// shows the cartoon). Lines are never cut.
function fitCard(card: ShotCard | undefined): ShotCard | undefined {
  if (!card) return undefined;
  const lines = card.lines.map((line) => line.trim()).filter(Boolean);
  const fitted = { style: card.style, lines: card.style === "QUOTE" ? [lines.join(" ")] : lines };
  if (!cardProblem(fitted)) return fitted;
  const punch: ShotCard = { style: "PUNCH", lines };
  return cardProblem(punch) ? undefined : punch;
}

// Keys in one fixed order and no empty fields, so the same plan always serialises (and hashes) the same way.
function normalizeShot(shot: Omit<AiShot, "from">, fromWord: number): PlannedShot {
  const props = shot.props?.filter((prop, index, all) => all.findIndex((other) => other.id === prop.id) === index);
  const card = fitCard(shot.card);
  return {
    fromWord,
    ...(shot.setting ? { setting: shot.setting } : {}),
    ...(shot.action ? { action: shot.action } : {}),
    ...(shot.mood ? { mood: shot.mood } : {}),
    ...(shot.size ? { size: shot.size } : {}),
    ...(shot.partner ? { partner: shot.partner } : {}),
    ...(props?.length
      ? { props: props.map((prop) => (prop.label ? { id: prop.id, label: prop.label } : { id: prop.id })) }
      : {}),
    ...(shot.tag ? { tag: shot.tag } : {}),
    ...(card ? { card } : {}),
    ...(shot.actors ? { actors: shot.actors } : {}),
  };
}

// Where `phrase` starts in the narration at or after word `after`: the longest leading part of it that is found, so a
// cue whose later words were reworded still lands on its first ones.
function findPhrase(tokens: readonly string[], phrase: string, after: number): number | null {
  const keys = spokenTokens(phrase).map(wordKey).filter(Boolean).slice(0, 5);
  for (let length = keys.length; length >= 1; length -= 1) {
    for (let start = after; start + length <= tokens.length; start += 1) {
      if (keys.slice(0, length).every((key, offset) => tokens[start + offset] === key)) return start;
    }
  }
  return null;
}

// A model's (or a moved) shot list on the narration's words. A cue that cannot be found is spread evenly between its
// neighbours; shots that no longer fit (more shots than words) are dropped. Null when nothing is left to plan.
export function planShots(
  narration: string,
  shots: readonly AiShot[] | undefined,
  maxShots = MAX_SHOTS_PER_SCENE,
): ShotPlan | null {
  const tokens = spokenTokens(narration).map(wordKey);
  if (!shots?.length || tokens.length === 0) return null;
  const kept = shots.slice(0, maxShots);
  const starts: (number | null)[] = [0];
  for (const shot of kept.slice(1)) {
    const previous = starts.findLast((start) => start !== null) ?? 0;
    starts.push(findPhrase(tokens, shot.from ?? "", previous + 1));
  }
  const resolved = starts.map((start, index) => {
    if (start !== null) return start;
    const before = starts.slice(0, index).findLastIndex((candidate) => candidate !== null);
    const afterOffset = starts.slice(index + 1).findIndex((candidate) => candidate !== null);
    const after = afterOffset === -1 ? starts.length : index + 1 + afterOffset;
    const from = starts[before] ?? 0;
    const to = after < starts.length ? (starts[after] ?? tokens.length) : tokens.length;
    return from + Math.round(((index - before) * (to - from)) / (after - before));
  });
  const plan: PlannedShot[] = [];
  kept.forEach((shot, index) => {
    const fromWord = resolved[index] ?? 0;
    const last = plan.at(-1);
    if (fromWord >= tokens.length || (last && fromWord <= last.fromWord)) return;
    const { from: _from, ...picture } = shot;
    plan.push(normalizeShot(picture, fromWord));
  });
  return plan.length > 0 ? plan : null;
}

// Keeps a scene's shots when its narration is rewritten: each shot follows the words it started on, or is spread evenly
// when those words are gone.
export function rebaseShotPlan(plan: ShotPlan, before: string, after: string): ShotPlan | null {
  if (before === after) return plan;
  const tokens = spokenTokens(before);
  return planShots(
    after,
    plan.map(({ fromWord, ...picture }) => ({ ...picture, from: tokens.slice(fromWord, fromWord + 3).join(" ") })),
    plan.length,
  );
}

export const maxShotsFor = (sceneType: string): number => (sceneType === "HOOK" ? MAX_HOOK_SHOTS : MAX_SHOTS_PER_SCENE);

// Why a plan cannot be kept on a scene with this narration, or null when it can.
export function shotPlanProblem(plan: ShotPlan, narration: string, sceneType: string): string | null {
  const words = spokenTokens(narration).length;
  const limit = maxShotsFor(sceneType);
  if (plan.length > limit) return `Cảnh này chỉ có tối đa ${limit} shot.`;
  if (plan.some((shot) => shot.fromWord >= words)) return "Có shot bắt đầu ngoài lời dẫn của cảnh.";
  return null;
}

export function parseShotPlan(json: string | null): ShotPlan | null {
  if (!json) return null;
  try {
    const parsed = shotPlanSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeShotPlan(plan: ShotPlan): string {
  return JSON.stringify(plan.map(({ fromWord, ...picture }) => normalizeShot(picture, fromWord)));
}

// The words a plan puts on screen, for the source check: a quote card counts as a quotation.
export function shotTexts(plan: readonly PlannedShot[] | null | undefined): string[] {
  return (plan ?? []).flatMap((shot) => [
    shot.tag ?? "",
    ...(shot.card?.style === "QUOTE" ? shot.card.lines.map((line) => `“${line}”`) : (shot.card?.lines ?? [])),
    ...(shot.props ?? []).map((prop) => prop.label ?? ""),
  ]);
}

// The words a model's shot list puts on screen, before its cues are resolved.
export function aiShotTexts(shots: readonly AiShot[] | undefined): string[] {
  return shotTexts(shots?.map(({ from: _from, ...picture }) => normalizeShot(picture, 0)));
}
