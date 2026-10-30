import { describe, expect, it } from "vitest";

import type { TimedWord } from "@/features/videos/domain/caption-pages";
import { toCompositionProps } from "@/features/videos/domain/composition-props";
import { alignWordTimings, shiftWordTimings } from "@/features/videos/domain/word-timing";

import recorded from "../../helpers/fixtures/edge-tts-word-boundaries.json";

// The live service's events for a sentence, in milliseconds, as the TTS adapter returns them.
function serviceWords(key: keyof typeof recorded.sentences): { text: string; boundaries: TimedWord[] } {
  const { text, events } = recorded.sentences[key];
  return {
    text,
    boundaries: events.map((event) => ({
      text: event.text,
      startMs: Math.round(event.offset / 10_000),
      endMs: Math.round((event.offset + event.duration) / 10_000),
    })),
  };
}

describe("aligning the voice's word timings with the narration", () => {
  it.each(Object.keys(recorded.sentences) as (keyof typeof recorded.sentences)[])(
    "matches every word of the recorded %s sentence, punctuation kept",
    (key) => {
      const { text, boundaries } = serviceWords(key);
      const words = alignWordTimings(text, boundaries);
      expect(words?.map((word) => word.text)).toEqual(text.split(/\s+/));
      expect(words?.map((word) => word.startMs)).toEqual(boundaries.map((word) => word.startMs));
    },
  );

  it("reads numbers, times and English words as single words", () => {
    const { text, boundaries } = serviceWords("abbrev");
    const words = alignWordTimings(text, boundaries) ?? [];
    expect(words.find((word) => word.text === "23:00,")).toMatchObject({ startMs: 350, endMs: 1150 });
    expect(words.find((word) => word.text === "deadline")).toBeDefined();
  });

  it("puts a word the voice skipped between its neighbours", () => {
    const { text, boundaries } = serviceWords("long");
    const missing = boundaries.filter((_, index) => index !== 5);
    const words = alignWordTimings(text, missing) ?? [];
    expect(words).toHaveLength(boundaries.length);
    expect(words[5]?.startMs).toBe(boundaries[4]?.endMs);
    expect(words[5]?.endMs).toBe(boundaries[6]?.startMs);
  });

  it("gives up when the timings belong to other words or run backwards", () => {
    const { boundaries } = serviceWords("names");
    expect(alignWordTimings("Một câu hoàn toàn khác với giọng đã đọc ở đây.", boundaries)).toBeNull();
    const { text, boundaries: ordered } = serviceWords("repeat");
    const backwards = ordered.map((word, index) => (index === 4 ? { ...word, startMs: 0 } : word));
    expect(alignWordTimings(text, backwards)).toBeNull();
  });
});

describe("moving timings onto the trimmed clip", () => {
  it("subtracts the trimmed silence and keeps every word inside the clip", () => {
    const words = [
      { text: "a", startMs: 100, endMs: 300 },
      { text: "b", startMs: 4900, endMs: 5200 },
    ];
    expect(shiftWordTimings(words, 80, 5000)).toEqual([
      { text: "a", startMs: 20, endMs: 220 },
      { text: "b", startMs: 4820, endMs: 5000 },
    ]);
  });
});

describe("captions in the composition props", () => {
  const source = (wordBoundaries: TimedWord[] | null) => {
    const { text } = serviceWords("quote");
    return {
      title: "Video",
      book: { title: "Sách" },
      scenes: [
        {
          id: "h",
          type: "HOOK" as const,
          visualVariant: "HOOK_QUESTION" as const,
          narration: text,
          onScreenText: "Nghe hợp lý. Sai.",
          durationFrames: 220,
          hidden: false,
          audioAssetId: "a",
          audio: { durationMs: 7050, leadingSilenceMs: 50, wordBoundaries },
        },
      ],
    };
  };

  it("light up the spoken word when the voice gave timings for the narration", () => {
    const { boundaries } = serviceWords("quote");
    const scene = toCompositionProps(source(boundaries)).scenes[0];
    expect(scene?.karaoke).toBe(true);
    expect(scene?.captionPages[0]?.lines[0]?.[0]).toMatchObject({ text: "Anh", startFrame: 3 });
  });

  it("are estimated, without karaoke, when the voice gave none", () => {
    expect(toCompositionProps(source(null)).scenes[0]?.karaoke).toBe(false);
  });
});
