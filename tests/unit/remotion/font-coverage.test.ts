import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LATIN_RANGE, VIETNAMESE_RANGE } from "@/remotion/theme/fonts";

const REMOTION_DIR = path.join(process.cwd(), "src/remotion");

function codePointRanges(...lists: string[]): [number, number][] {
  return lists
    .flatMap((list) => list.split(","))
    .map((range) => {
      const [low = "", high] = range.replace("U+", "").split("-");
      const start = Number.parseInt(low, 16);
      return [start, high ? Number.parseInt(high, 16) : start];
    });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("glyphs in the video", () => {
  it("only types characters the bundled font has, so the preview and the MP4 use the same font", () => {
    const ranges = codePointRanges(LATIN_RANGE, VIETNAMESE_RANGE);
    const covered = (codePoint: number) => ranges.some(([low, high]) => codePoint >= low && codePoint <= high);
    const files = fs
      .readdirSync(REMOTION_DIR, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(10);

    const outside: string[] = [];
    for (const file of files) {
      for (const char of withoutComments(fs.readFileSync(path.join(REMOTION_DIR, file), "utf8"))) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (!covered(codePoint)) outside.push(`${file}: ${char} (U+${codePoint.toString(16).toUpperCase()})`);
      }
    }
    expect(outside).toEqual([]);
  });
});
