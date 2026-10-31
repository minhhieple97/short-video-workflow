import { useMemo } from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { ShotCard } from "@/features/videos/domain/shot-plan";

import type { PeepLook } from "../peeps/peep";
import { Prop } from "../props/prop";
import { ACCENT, INK, LAYOUT, MISTAKE, SAFE_BOX, SOLUTION } from "../theme/tokens";
import { balanceLines } from "./balance-lines";
import { KineticHeadline } from "./kinetic-headline";
import { TextScene } from "./text-scene";

const STAGE = { viewBox: "0 0 1080 1920", style: { position: "absolute", inset: 0 } } as const;

interface CardProps {
  card: ShotCard;
  look: PeepLook;
  // The frame, within the shot, the card starts to appear on.
  enterAt: number;
  visibleAtStart: boolean;
}

// Two blocks, the mistake above and the better way below, each with its mark on its top edge. Both end above the
// captions.
const VERSUS_PANELS = [
  { y: 420, fill: MISTAKE, mark: "CROSS", direction: -1, delay: 0 },
  { y: 880, fill: SOLUTION, mark: "CHECK", direction: 1, delay: 14 },
] as const;
const PANEL_HEIGHT = 370;

function VersusCard({ card, enterAt, visibleAtStart }: CardProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = useMemo(() => card.lines.map((line) => balanceLines(line, 18, 3)), [card.lines]);
  return (
    <AbsoluteFill style={{ backgroundColor: INK, overflow: "hidden" }}>
      {VERSUS_PANELS.map((panel, index) => {
        const progress = visibleAtStart
          ? 1
          : spring({ frame: frame - enterAt - panel.delay, fps, config: { damping: 15, stiffness: 140 } });
        return (
          <AbsoluteFill key={panel.mark} style={{ translate: `${(1 - progress) * 1100 * panel.direction}px 0` }}>
            <svg {...STAGE}>
              <rect
                x={SAFE_BOX.left - 40}
                y={panel.y}
                width={LAYOUT.contentWidth + 80}
                height={PANEL_HEIGHT}
                rx={44}
                fill={panel.fill}
              />
              <circle cx={LAYOUT.contentCenterX} cy={panel.y} r={62} fill={INK} />
              <Prop id={panel.mark} x={LAYOUT.contentCenterX - 46} y={panel.y - 46} size={92} />
            </svg>
            <KineticHeadline
              lines={lines[index] ?? []}
              enterAt={enterAt + panel.delay}
              visibleAtStart={visibleAtStart}
              top={panel.y + 90}
              maxFontSize={76}
              color="#FFFFFF"
            />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
}

// One big figure and the words that explain it.
function NumberCard({ card, enterAt, visibleAtStart }: CardProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [value = "", caption = ""] = card.lines;
  const pop = visibleAtStart ? 1 : spring({ frame: frame - enterAt - 4, fps, config: { damping: 9, stiffness: 120 } });
  const lines = useMemo(() => balanceLines(caption, 16, 3), [caption]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#262560", overflow: "hidden" }}>
      <svg {...STAGE}>
        <circle cx={540} cy={820} r={430} fill="#3A3884" />
      </svg>
      <div style={{ position: "absolute", inset: 0, scale: `${0.6 + pop * 0.4}`, opacity: Math.min(1, pop * 1.5) }}>
        <KineticHeadline
          lines={[value]}
          emphasis={[value]}
          visibleAtStart
          top={560}
          maxFontSize={300}
          color="#FFFFFF"
          accent={ACCENT}
        />
      </div>
      {lines.length > 0 ? (
        <KineticHeadline
          lines={lines}
          enterAt={enterAt + 10}
          visibleAtStart={visibleAtStart}
          top={1060}
          maxFontSize={84}
          color="#FFFFFF"
        />
      ) : null}
    </AbsoluteFill>
  );
}

// A line from the book, set large on a dark page with an open book above it.
function QuoteCard({ card, enterAt, visibleAtStart }: CardProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = visibleAtStart ? 1 : spring({ frame: frame - enterAt, fps, config: { damping: 14 } });
  const lines = useMemo(() => balanceLines(card.lines[0] ?? "", 20, 7), [card.lines]);
  return (
    <AbsoluteFill style={{ backgroundColor: INK, overflow: "hidden" }}>
      <svg {...STAGE}>
        <g transform={`translate(${LAYOUT.contentCenterX} 500) scale(${pop})`}>
          <Prop id="OPEN_BOOK" x={-85} y={-85} size={170} />
        </g>
      </svg>
      <KineticHeadline
        lines={lines}
        enterAt={enterAt + 6}
        visibleAtStart={visibleAtStart}
        top={640}
        maxFontSize={82}
        color="#FFFFFF"
      />
    </AbsoluteFill>
  );
}

// A full-screen card for one shot: the planned words in one of five styles, over the video's own colours.
export function CardScene(props: CardProps) {
  const { card, look, enterAt, visibleAtStart } = props;
  switch (card.style) {
    case "PUNCH":
      return (
        <TextScene
          text={card.lines.join(" ")}
          lines={card.lines}
          layout="BIG_TAKEAWAY"
          look={look}
          enterAt={enterAt}
          visibleAtStart={visibleAtStart}
        />
      );
    case "LIST":
      return (
        <TextScene
          text={card.lines.join(" ")}
          lines={card.lines.map((line, index) => `${index + 1}. ${line}`)}
          layout="ACTION_CHECKLIST"
          look={look}
          enterAt={enterAt}
          visibleAtStart={visibleAtStart}
        />
      );
    case "VERSUS":
      return <VersusCard {...props} />;
    case "NUMBER":
      return <NumberCard {...props} />;
    case "QUOTE":
      return <QuoteCard {...props} />;
  }
}
