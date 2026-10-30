import { useCurrentFrame } from "remotion";

import type { PropId } from "@/features/videos/domain/props";

import { Prop } from "../../props/prop";
import { ACCENT } from "../../theme/tokens";

// Reusable pieces of the flat pastel sets, drawn in stage pixels (1080×1920) inside a set's <svg>. Motion is a pure
// function of the frame.

export function Clouds({ y, color = "#FFFFFF", speed = 0.15 }: { y: number; color?: string; speed?: number }) {
  const frame = useCurrentFrame();
  const drift = (frame * speed) % 1300;
  return (
    <g opacity={0.9}>
      {[
        [80, 0, 70],
        [520, 60, 54],
        [900, -20, 62],
      ].map(([x = 0, dy = 0, r = 60], index) => {
        const cx = ((x + drift) % 1300) - 110;
        return (
          <g key={index} transform={`translate(${cx} ${y + dy})`}>
            <ellipse cx="0" cy="0" rx={r * 1.6} ry={r * 0.55} fill={color} />
            <ellipse cx={-r * 0.5} cy={-r * 0.35} rx={r * 0.7} ry={r * 0.6} fill={color} />
            <ellipse cx={r * 0.45} cy={-r * 0.45} rx={r * 0.8} ry={r * 0.7} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

export function DayWindow({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-10" y="-10" width={width + 20} height={height + 20} rx="20" fill="#FFFFFF" />
      <clipPath id={`window-${x}-${y}`}>
        <rect width={width} height={height} rx="10" />
      </clipPath>
      <g clipPath={`url(#window-${x}-${y})`}>
        <rect width={width} height={height} fill="#9ED8F5" />
        <Clouds y={height * 0.35} speed={0.12} />
      </g>
      <rect x={width / 2 - 8} width="16" height={height} fill="#FFFFFF" />
      <rect y={height / 2 - 6} width={width} height="12" fill="#FFFFFF" />
      <rect x="-24" y={height + 4} width={width + 48} height="18" rx="9" fill="#EFD9C4" />
    </g>
  );
}

export function NightWindow({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const frame = useCurrentFrame();
  const stars = [
    [30, 40],
    [90, 120],
    [200, 60],
    [230, 190],
    [60, 230],
    [150, 260],
  ] as const;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-10" y="-10" width={width + 20} height={height + 20} rx="20" fill="#3B3D78" />
      <rect width={width} height={height} rx="10" fill="#141640" />
      {stars.map(([sx, sy], index) => (
        <circle
          key={index}
          cx={sx}
          cy={sy}
          r={3.5}
          fill="#FFF6D6"
          opacity={0.45 + 0.55 * Math.abs(Math.sin((frame + index * 17) / 20))}
        />
      ))}
      <circle cx={width * 0.68} cy={height * 0.3} r="40" fill="#FFF3C4" />
      <circle cx={width * 0.68 + 18} cy={height * 0.3 - 12} r="36" fill="#141640" />
      <rect x={width / 2 - 8} width="16" height={height} fill="#3B3D78" />
    </g>
  );
}

export function Shelf({
  x,
  y,
  width,
  color,
  items,
}: {
  x: number;
  y: number;
  width: number;
  color: string;
  items: PropId[];
}) {
  const slot = width / items.length;
  return (
    <g>
      {items.map((id, index) => (
        <Prop key={id} id={id} x={x + index * slot + (slot - 124) / 2} y={y - 118} size={124} />
      ))}
      <rect x={x} y={y} width={width} height="22" rx="8" fill={color} />
    </g>
  );
}

// A wall clock whose hands turn slowly with the frame.
export function WallClock({
  x,
  y,
  r,
  frame,
  rim = "#2F3B52",
}: {
  x: number;
  y: number;
  r: number;
  frame: number;
  rim?: string;
}) {
  const minute = (frame * 1.5) % 360;
  const hour = (frame * 0.125 + 120) % 360;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 8} fill={rim} />
      <circle r={r} fill="#FFFFFF" />
      <rect x="-4" y={-r * 0.75} width="8" height={r * 0.75} rx="4" fill={rim} transform={`rotate(${minute})`} />
      <rect x="-5" y={-r * 0.5} width="10" height={r * 0.5} rx="5" fill={rim} transform={`rotate(${hour})`} />
      <circle r="8" fill={ACCENT} />
    </g>
  );
}

// The furniture in front of a half-body character: a top surface from y 1180 to 1300, then its front down to the bottom.
export function Counter({
  top,
  edge,
  front,
  drawers = true,
  items,
}: {
  top: string;
  edge: string;
  front: string;
  drawers?: boolean;
  items: { id: PropId; x: number; size: number }[];
}) {
  return (
    <g>
      <rect y="1180" width="1080" height="120" fill={top} />
      <rect y="1300" width="1080" height="28" fill={edge} />
      <rect y="1328" width="1080" height="592" fill={front} />
      {drawers ? (
        <g fill={edge}>
          <rect x="110" y="1470" width="370" height="190" rx="16" />
          <rect x="600" y="1470" width="370" height="190" rx="16" />
          <rect x="250" y="1552" width="90" height="18" rx="9" fill={top} />
          <rect x="740" y="1552" width="90" height="18" rx="9" fill={top} />
        </g>
      ) : null}
      {items.map(({ id, x, size }) => (
        <Prop key={id} id={id} x={x} y={1250 - size} size={size} />
      ))}
    </g>
  );
}
