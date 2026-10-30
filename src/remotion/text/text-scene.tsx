import { useMemo } from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { PropId } from "@/features/videos/domain/props";
import type { VisualVariant } from "@/features/videos/domain/scene-types";

import type { PeepFaceName, PeepLook } from "../peeps/peep";
import { Prop } from "../props/prop";
import { PeepActor } from "../stage/peep-actor";
import { ACCENT, INK, SOLUTION } from "../theme/tokens";
import { balanceLines, listItems } from "./balance-lines";
import { autoEmphasis } from "./emphasis";
import { KineticHeadline } from "./kinetic-headline";

interface TextLook {
  background: string;
  motif: string;
  accent: string;
  icon: PropId;
  face: PeepFaceName;
}

const LOOKS: Record<"BIG_TAKEAWAY" | "ACTION_CHECKLIST", TextLook> = {
  BIG_TAKEAWAY: { background: "#262560", motif: "#3A3884", accent: ACCENT, icon: "LIGHT_BULB", face: "Awe" },
  ACTION_CHECKLIST: { background: INK, motif: "#2E2925", accent: SOLUTION, icon: "CHECK", face: "Driven" },
};

const STAGE = { viewBox: "0 0 1080 1920", style: { position: "absolute", inset: 0 } } as const;

function Motif({ color }: { color: string }) {
  const frame = useCurrentFrame();
  return (
    <svg {...STAGE}>
      <defs>
        <pattern id="text-dots" width="48" height="48" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="3" fill={color} />
        </pattern>
      </defs>
      <rect width="1080" height="1920" fill="url(#text-dots)" opacity="0.6" />
      <circle cx={180 + Math.sin(frame / 60) * 30} cy={1500} r="260" fill={color} />
      <circle cx={940 + Math.cos(frame / 70) * 24} cy={420} r="180" fill={color} />
    </svg>
  );
}

// Full-screen kinetic text for the lesson and the action: big words, one icon, the main character at the corner.
export function TextScene({
  text,
  layout,
  look,
  enterAt,
  visibleAtStart,
}: {
  text: string;
  layout: VisualVariant;
  look: PeepLook;
  enterAt: number;
  visibleAtStart: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = LOOKS[layout === "ACTION_CHECKLIST" ? "ACTION_CHECKLIST" : "BIG_TAKEAWAY"];
  const lines = useMemo(() => listItems(text) ?? balanceLines(text, 13, 4), [text]);
  const rise = visibleAtStart ? 1 : spring({ frame: frame - enterAt - 10, fps, config: { damping: 16 } });
  const bob = Math.sin(frame / 15) * 10;
  return (
    <AbsoluteFill style={{ backgroundColor: style.background, overflow: "hidden" }}>
      <Motif color={style.motif} />
      <KineticHeadline
        lines={lines}
        emphasis={autoEmphasis(text, lines)}
        enterAt={enterAt}
        visibleAtStart={visibleAtStart}
        top={440}
        maxFontSize={lines.length > 3 ? 104 : lines.length > 2 ? 120 : 136}
        color="#FFFFFF"
        accent={style.accent}
      />
      <svg {...STAGE}>
        <g transform={`translate(${190} ${1040 + bob}) scale(${rise})`}>
          <Prop id={style.icon} x={-110} y={-110} size={220} />
        </g>
      </svg>
      <div style={{ position: "absolute", inset: 0, translate: `0 ${(1 - rise) * 420}px` }}>
        <PeepActor body="Shirt" face={style.face} look={look} x={740} bottom={1272} height={370} />
      </div>
    </AbsoluteFill>
  );
}
