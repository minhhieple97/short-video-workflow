import { fitText } from "@remotion/layout-utils";
import { useMemo } from "react";
import { interpolate, useCurrentFrame } from "remotion";

import { activeWordIndex, type CaptionPage } from "@/features/videos/domain/caption-pages";

import { useFontCheck } from "../text/use-font-check";
import { ACTIVE_WORD, FONT_FAMILY, INK, LAYOUT, SAFE_BOX } from "../theme/tokens";

const MAX_FONT = 70;
const MIN_FONT = 52;

function fontSizeFor(page: CaptionPage, validateFontIsLoaded: boolean): number {
  // Measuring needs the browser and the loaded font; outside it (markup tests) the largest size stands in.
  if (typeof document === "undefined") return MAX_FONT;
  const widest = Math.min(
    ...page.lines.map(
      (line) =>
        fitText({
          text: line.map((word) => word.text).join(" "),
          withinWidth: LAYOUT.contentWidth - 40,
          fontFamily: FONT_FAMILY,
          fontWeight: 800,
          validateFontIsLoaded,
        }).fontSize,
    ),
  );
  return Math.max(MIN_FONT, Math.min(MAX_FONT, Math.floor(widest)));
}

const wordsBefore = (lines: readonly (readonly unknown[])[], lineIndex: number) =>
  lines.slice(0, lineIndex).reduce((sum, line) => sum + line.length, 0);

function PageView({ page, frame, highlight }: { page: CaptionPage; frame: number; highlight: boolean }) {
  const fontCheck = useFontCheck();
  const fontSize = useMemo(() => fontSizeFor(page, fontCheck), [page, fontCheck]);
  const active = highlight ? activeWordIndex(page, frame) : -1;
  const entrance = interpolate(frame - page.startFrame, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_BOX.left,
        right: SAFE_BOX.right,
        bottom: SAFE_BOX.bottom + 28,
        textAlign: "center",
        fontFamily: FONT_FAMILY,
        fontSize,
        fontWeight: 800,
        lineHeight: 1.24,
        color: "#FFFFFF",
        WebkitTextStroke: `${Math.round(fontSize / 5.5)}px ${INK}`,
        paintOrder: "stroke fill",
        textShadow: "0 5px 0 rgba(0,0,0,0.35)",
        opacity: Math.min(1, entrance * 2),
        scale: `${0.92 + entrance * 0.08}`,
        translate: `0 ${(1 - entrance) * 14}px`,
      }}
    >
      {page.lines.map((line, lineIndex) => (
        <div key={lineIndex}>
          {line.map((word, wordIndex) => {
            const index = wordsBefore(page.lines, lineIndex) + wordIndex;
            return (
              <span key={wordIndex} style={{ color: index === active ? ACTIVE_WORD : "#FFFFFF" }}>
                {wordIndex > 0 ? " " : ""}
                {word.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// The caption page on screen at the current frame of its scene; the spoken word is highlighted only when the timing comes
// from the voice itself (highlight), never from an estimate.
export function CaptionPagesView({ pages, highlight }: { pages: readonly CaptionPage[]; highlight: boolean }) {
  const frame = useCurrentFrame();
  const page = pages.find((candidate) => frame >= candidate.startFrame && frame < candidate.endFrame);
  return page ? <PageView page={page} frame={frame} highlight={highlight} /> : null;
}
