import { z } from "zod";

import type { LessonSnapshot } from "./lesson-snapshot";
import { findUnsupportedClaimsIn, hasUnsupportedClaims, type UnsupportedClaims } from "./source-claims";

// One set of title, caption and hashtags for TikTok, Facebook Reels and YouTube Shorts. The limits are the strictest of the
// three: a Shorts title holds 100 characters and a Reels caption 2,200.
export const PUBLISH_TITLE_MAX = 100;
export const PUBLISH_CAPTION_MAX = 2200;
export const PUBLISH_HASHTAGS_MIN = 3;
export const PUBLISH_HASHTAGS_MAX = 8;
export const PUBLISH_HASHTAG_MAX = 40;

export const PUBLISH_ORIGINS = ["AI", "EDITED"] as const;
export type PublishOrigin = (typeof PUBLISH_ORIGINS)[number];

export function toPublishOrigin(value: string): PublishOrigin {
  return PUBLISH_ORIGINS.find((origin) => origin === value) ?? "AI";
}

// Tags are stored without "#", in lowercase ASCII: people search for Vietnamese tags without diacritics, and one spelling
// per tag keeps the list free of near-duplicates.
export function normalizeHashtag(raw: string): string {
  return raw
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

export function normalizeHashtags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeHashtag).filter((tag) => tag.length > 0))];
}

export function parseHashtagInput(text: string): string[] {
  return normalizeHashtags(text.split(/[\s,;]+/));
}

const HASHTAG_IN_TEXT = /#[\p{L}\p{N}_]/u;

const publishText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} không được để trống.`)
    .max(max, `${label} tối đa ${max} ký tự.`)
    .refine((text) => !HASHTAG_IN_TEXT.test(text), `${label} không chứa hashtag; hashtag nằm ở ô riêng.`);

export const publishMetadataSchema = z.object({
  title: publishText("Tiêu đề", PUBLISH_TITLE_MAX).refine((text) => !text.includes("\n"), "Tiêu đề chỉ có một dòng."),
  caption: publishText("Caption", PUBLISH_CAPTION_MAX),
  hashtags: z
    .array(z.string())
    .transform(normalizeHashtags)
    .pipe(
      z
        .array(z.string().max(PUBLISH_HASHTAG_MAX, `Mỗi hashtag tối đa ${PUBLISH_HASHTAG_MAX} ký tự.`))
        .min(PUBLISH_HASHTAGS_MIN, `Cần ít nhất ${PUBLISH_HASHTAGS_MIN} hashtag.`)
        .max(PUBLISH_HASHTAGS_MAX, `Tối đa ${PUBLISH_HASHTAGS_MAX} hashtag.`),
    ),
});

export type PublishMetadata = z.output<typeof publishMetadataSchema>;
export type PublishMetadataDraft = z.input<typeof publishMetadataSchema>;

export interface PublishSources {
  book: { title: string; author: string | null };
  lessons: readonly LessonSnapshot[];
  scenes: readonly { title: string | null; narration: string; onScreenText: string }[];
}

// What a caption may draw on: the book's name, the lessons the video uses and the script itself. Numbers and quotations
// that appear in none of them are made up.
export function publishClaimSources(sources: PublishSources): string[] {
  return [
    sources.book.title,
    sources.book.author ?? "",
    ...sources.lessons.flatMap((lesson) => [
      lesson.title,
      lesson.summary,
      lesson.principle,
      lesson.realLifeScenario,
      lesson.commonMistake,
      lesson.betterApproach,
      lesson.actionableStep,
      ...lesson.sources.map((source) => source.excerpt ?? ""),
    ]),
    ...sources.scenes.flatMap((scene) => [scene.title ?? "", scene.narration, scene.onScreenText]),
  ];
}

export type PublishMetadataIssue =
  | { code: "PUBLISH_METADATA_INVALID"; message: string }
  | { code: "PUBLISH_METADATA_UNSUPPORTED_CLAIM"; message: string; claims: UnsupportedClaims };

export type PublishMetadataAcceptance =
  { metadata: PublishMetadata; issue: null } | { metadata: null; issue: PublishMetadataIssue };

// The AI's proposal is checked after the fact rather than by the task's output schema, so a caption that breaks a rule is
// dropped on its own and never costs the script it came with.
export function acceptPublishMetadata(
  draft: PublishMetadataDraft,
  sources: readonly string[],
): PublishMetadataAcceptance {
  const parsed = publishMetadataSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      metadata: null,
      issue: { code: "PUBLISH_METADATA_INVALID", message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." },
    };
  }
  const { title, caption, hashtags } = parsed.data;
  const claims = findUnsupportedClaimsIn([title, caption, ...hashtags], sources);
  if (hasUnsupportedClaims(claims)) {
    return {
      metadata: null,
      issue: {
        code: "PUBLISH_METADATA_UNSUPPORTED_CLAIM",
        message: "Tiêu đề hoặc caption có số liệu hay trích dẫn không có trong kịch bản, bài học và sách.",
        claims,
      },
    };
  }
  return { metadata: parsed.data, issue: null };
}

export const formatHashtags = (tags: readonly string[]): string => tags.map((tag) => `#${tag}`).join(" ");

export const captionWithHashtags = (metadata: PublishMetadata): string =>
  `${metadata.caption}\n\n${formatHashtags(metadata.hashtags)}`;

// The text of publish.txt next to the archived video: the title on its own, then the caption ready to paste with its tags.
export function formatPublishText(metadata: PublishMetadata): string {
  return ["TIÊU ĐỀ", metadata.title, "", "CAPTION", captionWithHashtags(metadata), ""].join("\n");
}
