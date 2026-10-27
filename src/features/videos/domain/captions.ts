import { countSyllables } from "./duration";

export interface CaptionCue {
  text: string;
  startFrame: number;
  endFrame: number;
}

const MAX_WORDS_PER_CUE = 9;

// Splits narration at punctuation, then caps each phrase at a few words so captions stay short on a phone screen.
export function splitCaptionPhrases(narration: string): string[] {
  const clauses = narration
    .split(/(?<=[,.;:!?…])\s+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.flatMap((clause) => {
    const words = clause.split(/\s+/);
    const chunks: string[] = [];
    for (let index = 0; index < words.length; index += MAX_WORDS_PER_CUE) {
      chunks.push(words.slice(index, index + MAX_WORDS_PER_CUE).join(" "));
    }
    return chunks;
  });
}

// Phrase-level timing proportional to syllables — good enough for subtitles without word alignment.
export function buildCaptionCues(narration: string, durationInFrames: number): CaptionCue[] {
  const phrases = splitCaptionPhrases(narration);
  const weights = phrases.map((phrase) => Math.max(1, countSyllables(phrase)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return phrases.map((text, index) => {
    const startFrame = cursor;
    const isLast = index === phrases.length - 1;
    const endFrame = isLast
      ? durationInFrames
      : Math.round(cursor + ((weights[index] ?? 1) / total) * durationInFrames);
    cursor = endFrame;
    return { text, startFrame, endFrame };
  });
}
