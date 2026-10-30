// Pages of on-screen captions built from timed words: what the viewer reads at once (at most two short lines), and which
// word is being spoken. Pure, so the browser preview and the worker render show the same pages.

export interface TimedWord {
  // As written in the narration, punctuation attached.
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionWord {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface CaptionPage {
  startFrame: number;
  endFrame: number;
  lines: CaptionWord[][];
}

export const CAPTION_LINE_CHARS = 22;
const MAX_WORDS_PER_PAGE = 8;
const MIN_WORDS_BEFORE_COMMA_BREAK = 4;
const PAUSE_BREAK_MS = 300;
// A page stays up through a short pause instead of blinking off and on.
const HOLD_FRAMES = 18;

const SENTENCE_END = /[.!?…]["”»)]*$/;
const CLAUSE_END = /[,;:]["”»)]*$/;

const lengthOf = (words: readonly { text: string }[]) =>
  words.reduce((sum, word, index) => sum + word.text.length + (index > 0 ? 1 : 0), 0);

// Two lines of as equal a length as possible, or one line when the words fit.
function splitLines<T extends { text: string }>(words: T[]): T[][] {
  if (lengthOf(words) <= CAPTION_LINE_CHARS || words.length < 2) return [words];
  let best = 1;
  let bestDifference = Infinity;
  for (let cut = 1; cut < words.length; cut += 1) {
    const difference = Math.abs(lengthOf(words.slice(0, cut)) - lengthOf(words.slice(cut)));
    if (difference < bestDifference) {
      best = cut;
      bestDifference = difference;
    }
  }
  return [words.slice(0, best), words.slice(best)];
}

function fitsOnPage(page: readonly TimedWord[], next: TimedWord): boolean {
  if (page.length >= MAX_WORDS_PER_PAGE) return false;
  const lines = splitLines([...page, next]);
  return lines.length <= 2 && lines.every((line) => lengthOf(line) <= CAPTION_LINE_CHARS);
}

function groupWords(words: readonly TimedWord[]): TimedWord[][] {
  const pages: TimedWord[][] = [];
  let current: TimedWord[] = [];
  words.forEach((word, index) => {
    if (current.length > 0 && !fitsOnPage(current, word)) {
      pages.push(current);
      current = [];
    }
    current.push(word);
    const next = words[index + 1];
    const pause = next ? next.startMs - word.endMs : 0;
    const breakHere =
      SENTENCE_END.test(word.text) ||
      (CLAUSE_END.test(word.text) && current.length >= MIN_WORDS_BEFORE_COMMA_BREAK) ||
      pause >= PAUSE_BREAK_MS;
    if (breakHere) {
      pages.push(current);
      current = [];
    }
  });
  if (current.length > 0) pages.push(current);
  return pages;
}

export function buildCaptionPages(words: readonly TimedWord[], fps: number, sceneFrames: number): CaptionPage[] {
  const toFrame = (ms: number) => Math.max(0, Math.min(sceneFrames, Math.round((ms / 1000) * fps)));
  const groups = groupWords(words.filter((word) => word.text.trim().length > 0));
  return groups.map((group, index) => {
    const timed = group.map((word) => ({
      text: word.text,
      startFrame: toFrame(word.startMs),
      endFrame: toFrame(word.endMs),
    }));
    const first = timed[0];
    const last = timed.at(-1);
    const next = groups[index + 1]?.[0];
    const nextStart = next ? toFrame(next.startMs) : sceneFrames;
    const ownEnd = last ? last.endFrame + HOLD_FRAMES : sceneFrames;
    return {
      startFrame: index === 0 ? 0 : (first?.startFrame ?? 0),
      endFrame: next ? (nextStart - ownEnd < HOLD_FRAMES ? nextStart : Math.min(ownEnd, nextStart)) : sceneFrames,
      lines: splitLines(timed),
    };
  });
}

// The word being spoken at a frame of the page: the last one that has started.
export function activeWordIndex(page: CaptionPage, frame: number): number {
  let active = -1;
  page.lines.flat().forEach((word, index) => {
    if (word.startFrame <= frame) active = index;
  });
  return active;
}
