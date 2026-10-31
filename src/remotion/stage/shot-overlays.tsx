import { spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { ShotProp } from "@/features/videos/domain/shot-plan";

import { Prop } from "../props/prop";
import { FONT_FAMILY, INK, LAYOUT, PAPER } from "../theme/tokens";

// The outer edges of the picture band, clear of a lone character and of a pair of them.
const SLOTS = [
  { x: 135, y: 1040 },
  { x: 945, y: 1040 },
] as const;
const PROP_SIZE = 150;

// The objects a shot shows, at the two sides of the picture band, each with its short label. They sit on the screen, not
// on the camera's stage, so a close shot never crops them.
export function ShotProps({ props }: { props: readonly ShotProp[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, fontFamily: FONT_FAMILY }}>
      {props.map((prop, index) => {
        const slot = SLOTS[index] ?? SLOTS[0];
        const pop = spring({ frame: frame - 8 - index * 6, fps, config: { damping: 11, stiffness: 150 } });
        const bob = Math.sin(frame / 16 + index * 2) * 7;
        return (
          <g key={prop.id} transform={`translate(${slot.x} ${slot.y + bob}) scale(${pop})`}>
            <Prop id={prop.id} x={-PROP_SIZE / 2} y={-PROP_SIZE / 2} size={PROP_SIZE} />
            {prop.label ? (
              <g transform={`translate(0 ${PROP_SIZE / 2 + 34})`}>
                <rect
                  x={-prop.label.length * 12 - 22}
                  y={-30}
                  width={prop.label.length * 24 + 44}
                  height={56}
                  rx={28}
                  fill={PAPER}
                />
                <text textAnchor="middle" y={9} fontSize={32} fontWeight={800} fill={INK}>
                  {prop.label}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// A short line on the picture, such as a time skip ("Ngày thứ 3"): a dark pill at the foot of the picture band.
export function ShotTag({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 4, fps, config: { damping: 13, stiffness: 150 } });
  const width = text.length * 26 + 70;
  return (
    <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, fontFamily: FONT_FAMILY }}>
      <g transform={`translate(${LAYOUT.contentCenterX} ${LAYOUT.pictureBottom - 50}) scale(${pop})`}>
        <rect x={-width / 2} y={-34} width={width} height={68} rx={34} fill={INK} />
        <text textAnchor="middle" y={12} fontSize={38} fontWeight={800} fill="#FFFFFF">
          {text}
        </text>
      </g>
    </svg>
  );
}
