import { describe, expect, it } from "vitest";

import {
  activeWordIndex,
  buildCaptionPages,
  CAPTION_LINE_CHARS,
  type TimedWord,
} from "@/features/videos/domain/caption-pages";
import { toCompositionProps } from "@/features/videos/domain/composition-props";
import {
  buildSceneShots,
  MAX_SHOT_FRAMES,
  MIN_SHOT_FRAMES,
  renderModeFor,
  shotStarts,
} from "@/features/videos/domain/scene-shots";
import { estimateWordTimings } from "@/features/videos/domain/word-timing";

import recorded from "../../helpers/fixtures/edge-tts-word-boundaries.json";

const FPS = 30;

// The live edge-tts events for a sentence, joined back to the sentence's own words (punctuation kept).
function recordedWords(key: keyof typeof recorded.sentences): TimedWord[] {
  const { text, events } = recorded.sentences[key];
  const tokens = text.split(/\s+/);
  expect(tokens).toHaveLength(events.length);
  return tokens.map((token, index) => {
    const event = events[index] ?? { offset: 0, duration: 0 };
    return { text: token, startMs: event.offset / 10_000, endMs: (event.offset + event.duration) / 10_000 };
  });
}

describe("estimated word timings", () => {
  it("spreads the words over the spoken span in order, pausing after punctuation", () => {
    const words = estimateWordTimings("Tối nay, mang giày chạy và bước ra cửa.", { startMs: 200, endMs: 3200 });
    expect(words.map((word) => word.text)).toEqual(["Tối", "nay,", "mang", "giày", "chạy", "và", "bước", "ra", "cửa."]);
    expect(words[0]?.startMs).toBe(200);
    expect(words.at(-1)?.endMs).toBe(3200);
    for (const [index, word] of words.entries()) {
      expect(word.endMs).toBeGreaterThan(word.startMs);
      if (index > 0) expect(word.startMs).toBeGreaterThanOrEqual(words[index - 1]?.endMs ?? 0);
    }
    const afterComma = (words[2]?.startMs ?? 0) - (words[1]?.endMs ?? 0);
    expect(afterComma).toBeGreaterThan(0);
  });

  it("returns nothing for narration without words", () => {
    expect(estimateWordTimings("  … ", { startMs: 0, endMs: 1000 })).toEqual([]);
  });
});

describe("caption pages", () => {
  const sceneFrames = 300;

  it("shows every word exactly once, in order, on at most two short lines", () => {
    const words = recordedWords("long");
    const pages = buildCaptionPages(words, FPS, sceneFrames);
    expect(pages.flatMap((page) => page.lines.flat().map((word) => word.text))).toEqual(words.map((w) => w.text));
    for (const page of pages) {
      expect(page.lines.length).toBeLessThanOrEqual(2);
      for (const line of page.lines) {
        const text = line.map((word) => word.text).join(" ");
        if (line.length > 1) expect(text.length).toBeLessThanOrEqual(CAPTION_LINE_CHARS);
      }
    }
  });

  it("starts the first page at the scene start, keeps pages in order and ends the last with the scene", () => {
    const pages = buildCaptionPages(recordedWords("quote"), FPS, sceneFrames);
    expect(pages[0]?.startFrame).toBe(0);
    expect(pages.at(-1)?.endFrame).toBe(sceneFrames);
    for (const [index, page] of pages.entries()) {
      expect(page.endFrame).toBeGreaterThan(page.startFrame);
      if (index > 0) expect(page.startFrame).toBeGreaterThanOrEqual(pages[index - 1]?.endFrame ?? 0);
    }
  });

  it("breaks after a sentence and at a pause in the voice", () => {
    const pages = buildCaptionPages(recordedWords("quote"), FPS, sceneFrames);
    const texts = pages.map((page) =>
      page.lines
        .flat()
        .map((word) => word.text)
        .join(" "),
    );
    expect(texts).toContain("Nghe hợp lý.");
    expect(texts).toContain("Sai.");
    expect(texts.some((text) => text.startsWith("Anh nhủ thầm:"))).toBe(true);
  });

  it("lights the word that has started speaking, and none before the first", () => {
    const [page] = buildCaptionPages(recordedWords("numbers"), FPS, sceneFrames);
    if (!page) throw new Error("no page");
    const words = page.lines.flat();
    expect(activeWordIndex(page, (words[1]?.startFrame ?? 0) + 1)).toBe(1);
    expect(activeWordIndex(page, -1)).toBe(-1);
  });
});

describe("scene shots", () => {
  it("cuts on caption page starts, never shorter than the minimum nor longer than the maximum", () => {
    const starts = shotStarts([0, 40, 95, 160, 230, 300, 470], 520);
    expect(starts[0]).toBe(0);
    const bounds = [...starts, 520];
    for (let index = 0; index < starts.length; index += 1) {
      const length = (bounds[index + 1] ?? 0) - (bounds[index] ?? 0);
      expect(length).toBeGreaterThanOrEqual(MIN_SHOT_FRAMES);
      expect(length).toBeLessThanOrEqual(MAX_SHOT_FRAMES);
    }
  });

  it("splits a long scene without page starts evenly and keeps a short one whole", () => {
    expect(shotStarts([0], 400)).toEqual([0, 133, 267]);
    expect(shotStarts([0, 30], 60)).toEqual([0]);
  });

  it("alternates shot sizes on the stage and keeps a text card in one shot", () => {
    const shots = buildSceneShots([0, 80, 160], 260, "STAGE", "WIDE");
    expect(shots.map((shot) => shot.size)).toEqual(["WIDE", "MEDIUM", "WIDE"]);
    expect(shots.reduce((sum, shot) => sum + shot.durationInFrames, 0)).toBe(260);
    expect(buildSceneShots([0, 80, 160], 260, "TEXT", "WIDE")).toEqual([
      { startFrame: 0, durationInFrames: 260, size: "WIDE" },
    ]);
  });

  it("draws the lesson and the action as text, and story moments on the stage", () => {
    expect(renderModeFor("BIG_TAKEAWAY")).toBe("TEXT");
    expect(renderModeFor("ACTION_CHECKLIST")).toBe("TEXT");
    expect(renderModeFor("SCENARIO_CARD")).toBe("STAGE");
  });
});

describe("caption pages and shots in the composition props", () => {
  const scene = (id: string, type: "HOOK" | "SITUATION" | "COMMON_MISTAKE", frames: number) => ({
    id,
    type,
    visualVariant: "SCENARIO_CARD" as const,
    narration: "Khôi nằm nhìn trần nhà đến ba giờ sáng, nghĩ về hợp đồng, về sếp, về khoản vay.",
    onScreenText: "Ba giờ sáng",
    durationFrames: frames,
    hidden: false,
    audioAssetId: null,
    illustration: { setting: "NIGHT_ROOM" as const, action: "WORRIED" as const },
  });

  it("opens the hook on a medium shot and cuts the next scene in the same place on the other size", () => {
    const props = toCompositionProps({
      title: "Video",
      book: { title: "Sách" },
      scenes: [scene("h", "HOOK", 110), scene("s", "SITUATION", 330), scene("m", "COMMON_MISTAKE", 300)],
    });
    expect(props.scenes[0]?.shots[0]?.size).toBe("MEDIUM");
    for (let index = 1; index < props.scenes.length; index += 1) {
      const previousLast = props.scenes[index - 1]?.shots.at(-1)?.size;
      expect(props.scenes[index]?.shots[0]?.size).not.toBe(previousLast);
    }
    expect(props.scenes.every((each) => each.karaoke === false && each.captionPages.length > 0)).toBe(true);
  });

  it("starts the caption words after the voice's leading silence", () => {
    const props = toCompositionProps({
      title: "Video",
      book: { title: "Sách" },
      scenes: [{ ...scene("h", "HOOK", 120), audio: { durationMs: 3900, leadingSilenceMs: 600 } }],
    });
    expect(props.scenes[0]?.captionPages[0]?.lines[0]?.[0]?.startFrame).toBe(18);
  });
});
