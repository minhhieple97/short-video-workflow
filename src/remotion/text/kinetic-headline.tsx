import { fitText } from "@remotion/layout-utils";
import { useMemo } from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ACCENT, FONT_FAMILY, INK, LAYOUT, SAFE_BOX } from "../theme/tokens";
import { useFontCheck } from "./use-font-check";

export interface KineticHeadlineProps {
  lines: readonly string[];
  // Words drawn on an accent block (compared without case and trailing punctuation).
  emphasis?: readonly string[];
  // Frame the first word starts to appear; a hook passes `visibleAtStart` so every word is readable at frame 0.
  enterAt?: number;
  visibleAtStart?: boolean;
  maxFontSize?: number;
  top?: number;
  // Puts every word on a light block, for headlines over a busy close-up.
  plate?: boolean;
  color?: string;
  accent?: string;
}

const key = (word: string) => word.toLocaleLowerCase("vi").replace(/[.,;:!?…"“”]+$/u, "");

function sizeFor(lines: readonly string[], max: number, validateFontIsLoaded: boolean): number {
  if (typeof document === "undefined") return max;
  const fits = lines.map(
    (line) =>
      fitText({
        text: line,
        withinWidth: LAYOUT.contentWidth,
        fontFamily: FONT_FAMILY,
        fontWeight: 800,
        validateFontIsLoaded,
      }).fontSize,
  );
  // Blocks behind emphasised words add a little width the measurement does not see.
  return Math.max(56, Math.min(max, Math.floor(Math.min(...fits) * 0.9)));
}

// Big words that pop in one after another; emphasised words sit on an accent block.
export function KineticHeadline({
  lines,
  emphasis = [],
  enterAt = 0,
  visibleAtStart = false,
  maxFontSize = 124,
  top = LAYOUT.headlineTop,
  color = INK,
  accent = ACCENT,
  plate = false,
}: KineticHeadlineProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Measuring touches the DOM, so it runs once per text, not once per frame (callers may pass a new array each frame).
  const text = lines.join("\n");
  const fontCheck = useFontCheck();
  const fontSize = useMemo(() => sizeFor(text.split("\n"), maxFontSize, fontCheck), [text, maxFontSize, fontCheck]);
  const strong = new Set(emphasis.flatMap((phrase) => phrase.split(/\s+/).map(key)));
  const words = lines.map((line) => line.split(/\s+/));
  return (
    <div style={{ position: "absolute", top, left: SAFE_BOX.left, right: SAFE_BOX.right, fontFamily: FONT_FAMILY }}>
      {lines.map((line, lineIndex) => (
        <div
          key={lineIndex}
          style={{ display: "flex", flexWrap: "wrap", gap: `0 ${fontSize * 0.16}px`, lineHeight: 1.14 }}
        >
          {(words[lineIndex] ?? []).map((word, wordIndex) => {
            const order = words.slice(0, lineIndex).reduce((sum, each) => sum + each.length, 0) + wordIndex + 1;
            const pop = spring({
              frame: frame - enterAt - order * 2,
              fps,
              config: { damping: 14, stiffness: 160, mass: 0.6 },
            });
            const shown = visibleAtStart ? 1 : pop;
            const isStrong = strong.has(key(word));
            return (
              <span
                key={wordIndex}
                style={{
                  fontSize,
                  fontWeight: 800,
                  color: isStrong ? "#FFFFFF" : plate ? INK : color,
                  background: isStrong ? accent : plate ? "#FFFDF8" : "transparent",
                  borderRadius: fontSize * 0.12,
                  padding: isStrong || plate ? `0 ${fontSize * 0.1}px` : 0,
                  opacity: Math.min(1, shown * 1.4),
                  translate: `0 ${(1 - shown) * 40}px`,
                  scale: `${visibleAtStart ? 0.94 + pop * 0.06 : 0.8 + pop * 0.2}`,
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
