import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { Prop } from "../props/prop";
import { ACCENT, MISTAKE, SOLUTION } from "../theme/tokens";
import type { CastExtra } from "./cast";

const CONFETTI = [ACCENT, "#FFC83D", SOLUTION, "#5B8DEF", MISTAKE] as const;

const STAGE = { viewBox: "0 0 1080 1920", style: { position: "absolute", inset: 0 } } as const;

// Small signs around the character that say what it feels or does, placed beside the head (about x 520, y 780 on the
// stage) and kept below the headline band.
export function CastExtras({ extra }: { extra: CastExtra }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 6, fps, config: { damping: 12, stiffness: 140 } });
  const bob = Math.sin(frame / 14) * 8;
  switch (extra) {
    case "THOUGHT":
    case "SPEECH":
      return (
        <svg {...STAGE}>
          <g transform={`translate(700 ${640 + bob}) scale(${pop})`}>
            <Prop id={extra === "THOUGHT" ? "THOUGHT_BALLOON" : "SPEECH_BALLOON"} x={-80} y={-80} size={160} />
          </g>
        </svg>
      );
    case "IDEA":
      return (
        <svg {...STAGE}>
          <g transform={`translate(700 ${650 + bob}) scale(${pop})`}>
            {Array.from({ length: 8 }, (_, index) => (
              <rect
                key={index}
                x="-5"
                y="-118"
                width="10"
                height="30"
                rx="5"
                fill="#FFC83D"
                transform={`rotate(${index * 45 + frame * 0.6})`}
              />
            ))}
            <Prop id="LIGHT_BULB" x={-70} y={-70} size={140} />
          </g>
        </svg>
      );
    case "SWEAT": {
      const fall = (frame % 40) / 40;
      return (
        <svg {...STAGE}>
          <path
            d="M 0 -26 Q 16 0 0 14 Q -16 0 0 -26 Z"
            fill="#7CC7F2"
            transform={`translate(${410} ${690 + fall * 40})`}
            opacity={1 - fall}
          />
        </svg>
      );
    }
    case "CONFETTI":
      return (
        <svg {...STAGE}>
          {Array.from({ length: 18 }, (_, index) => {
            const x = 90 + ((index * 151) % 900);
            const y = interpolate((frame * (2 + (index % 3)) + index * 97) % 700, [0, 700], [600, 1250]);
            return (
              <rect
                key={index}
                x={x}
                y={y}
                width="18"
                height="10"
                rx="3"
                fill={CONFETTI[index % CONFETTI.length]}
                transform={`rotate(${(frame * 6 + index * 40) % 360} ${x + 9} ${y + 5})`}
              />
            );
          })}
          <g transform={`translate(${740} ${700 + bob}) scale(${pop})`}>
            <Prop id="PARTY_POPPER" x={-60} y={-60} size={120} />
          </g>
        </svg>
      );
  }
}
