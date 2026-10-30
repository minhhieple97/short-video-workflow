import type { TimedWord } from "./caption-pages";

// Extra weight a punctuation mark adds after its word, in syllables: speakers pause there, so the next word starts later.
const PAUSE_AFTER: readonly [RegExp, number][] = [
  [/[.!?…]["”»)]*$/u, 1.6],
  [/[,;:]["”»)]*$/u, 0.8],
];

const syllablesIn = (token: string) => Math.max(1, (token.match(/[\p{L}\p{N}]+/gu) ?? []).length);

// Word timings spread over the spoken span by syllables, for narration whose real timing is unknown (an uploaded clip, a
// voice made before word timings were recorded, or no voice yet). Good enough to page captions; never shown as karaoke.
export function estimateWordTimings(narration: string, span: { startMs: number; endMs: number }): TimedWord[] {
  const tokens = narration.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
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
