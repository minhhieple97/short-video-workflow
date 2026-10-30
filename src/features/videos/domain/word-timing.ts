import { z } from "zod";

import type { TimedWord } from "./caption-pages";

export const timedWordsSchema = z.array(
  z.object({ text: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() }),
);

// Extra weight a punctuation mark adds after its word, in syllables: speakers pause there, so the next word starts later.
const PAUSE_AFTER: readonly [RegExp, number][] = [
  [/[.!?…]["”»)]*$/u, 1.6],
  [/[,;:]["”»)]*$/u, 0.8],
];

// The share of the narration's words that must be found in the voice's timings before captions follow the voice.
const MIN_ALIGNED_SHARE = 0.9;
const LOOK_AHEAD = 3;

const spokenTokens = (narration: string) => narration.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
const syllablesIn = (token: string) => Math.max(1, (token.match(/[\p{L}\p{N}]+/gu) ?? []).length);
// Compared without case, accents written in different Unicode forms, or punctuation.
const keyOf = (text: string) =>
  text
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[^\p{L}\p{N}]/gu, "");

// Word timings spread over the spoken span by syllables, for narration whose real timing is unknown (an uploaded clip, a
// voice made before word timings were recorded, or no voice yet). Good enough to page captions; never shown as karaoke.
export function estimateWordTimings(narration: string, span: { startMs: number; endMs: number }): TimedWord[] {
  const tokens = spokenTokens(narration);
  if (tokens.length === 0) return [];
  const pauses = tokens.map((token, index) =>
    index === tokens.length - 1 ? 0 : (PAUSE_AFTER.find(([pattern]) => pattern.test(token))?.[1] ?? 0),
  );
  const weights = tokens.map(syllablesIn);
  const total = weights.reduce((sum, weight) => sum + weight, 0) + pauses.reduce((sum, pause) => sum + pause, 0);
  const msPerUnit = Math.max(0, span.endMs - span.startMs) / total;
  let cursor = span.startMs;
  return tokens.map((text, index) => {
    const startMs = Math.round(cursor);
    cursor += (weights[index] ?? 1) * msPerUnit;
    const endMs = Math.round(cursor);
    cursor += (pauses[index] ?? 0) * msPerUnit;
    return { text, startMs, endMs };
  });
}

// Moves timings measured on the voice before its leading silence was trimmed onto the trimmed clip, keeping every word
// inside the clip.
export function shiftWordTimings(words: readonly TimedWord[], shiftMs: number, durationMs: number): TimedWord[] {
  const clamp = (ms: number) => Math.max(0, Math.min(durationMs, Math.round(ms - shiftMs)));
  return words.map((word) => ({ text: word.text, startMs: clamp(word.startMs), endMs: clamp(word.endMs) }));
}

// The narration's own words (punctuation kept) on the voice's timings. The service names each word it spoke, so the two
// lists are matched word by word, skipping ahead a little where one has a word the other lacks (a number read out, a
// symbol). Words left unmatched take their place between their neighbours. Null when too few words match or the
// timings run backwards: the captions then fall back to the estimate.
export function alignWordTimings(narration: string, boundaries: readonly TimedWord[]): TimedWord[] | null {
  const tokens = spokenTokens(narration);
  if (tokens.length === 0 || boundaries.length === 0) return null;
  const events = boundaries.map((event) => ({ ...event, key: keyOf(event.text) }));
  const matched: (TimedWord | null)[] = tokens.map(() => null);
  let next = 0;
  tokens.forEach((token, index) => {
    const key = keyOf(token);
    const found = events.slice(next, next + LOOK_AHEAD + 1).findIndex((event) => event.key === key);
    if (found === -1) return;
    const event = events[next + found];
    if (event) matched[index] = { text: token, startMs: event.startMs, endMs: event.endMs };
    next += found + 1;
  });
  const hits = matched.filter((word) => word !== null).length;
  if (hits / tokens.length < MIN_ALIGNED_SHARE) return null;
  const words = matched.map((word, index) => {
    if (word) return word;
    const before = matched.slice(0, index).findLast((candidate) => candidate !== null);
    const after = matched.slice(index + 1).find((candidate) => candidate !== null);
    const startMs = before?.endMs ?? 0;
    const endMs = after?.startMs ?? startMs;
    return { text: tokens[index] ?? "", startMs, endMs: Math.max(startMs, endMs) };
  });
  const ordered = words.every((word, index) => index === 0 || word.startMs >= (words[index - 1]?.startMs ?? 0));
  return ordered ? words : null;
}
