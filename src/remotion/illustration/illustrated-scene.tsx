import { AbsoluteFill, useCurrentFrame } from "remotion";

import type { CharacterAction, Illustration } from "@/features/videos/domain/illustration";

import { appear, cycle, wave } from "./anim";
import { Backdrop, FLOOR_Y } from "./backdrops";
import { Character } from "./character";
import { useCharacterLook } from "./look";

const CHARACTER_X = 540;

// What goes with an action, drawn around the character's head (which sits near y = 400 on the canvas).
function ActionExtras({ action, frame }: Readonly<{ action: CharacterAction; frame: number }>) {
  const grow = appear(frame, 14);
  switch (action) {
    case "THINKING":
      return (
        <g transform={`translate(700 330) scale(${grow})`} fill="#ffffff" stroke="#1c1917" strokeWidth={4}>
          <circle cx={-60} cy={110} r={12} />
          <circle cx={-30} cy={70} r={20} />
          <ellipse cx={60} cy={0} rx={120} ry={78} />
          {[0, 1, 2].map((index) => (
            <circle
              key={index}
              cx={20 + index * 40}
              cy={0}
              r={10}
              fill="#1c1917"
              opacity={cycle(frame + index * 8, 30) < 0.5 ? 1 : 0.3}
            />
          ))}
        </g>
      );
    case "WORRIED":
      return (
        <g>
          <path
            d="M 0 0 q 14 22 0 36 q -14 -14 0 -36 Z"
            fill="#74c0fc"
            stroke="#1c1917"
            strokeWidth={3}
            transform={`translate(640 ${360 + cycle(frame, 30) * 80})`}
            opacity={1 - cycle(frame, 30)}
          />
          <g stroke="#e03131" strokeWidth={6} strokeLinecap="round" opacity={0.6 + wave(frame, 12, 0.4)}>
            <line x1={430} y1={330} x2={410} y2={300} />
            <line x1={650} y1={330} x2={670} y2={300} />
          </g>
        </g>
      );
    case "TALKING":
      return (
        <g transform={`translate(760 330) scale(${grow})`}>
          <path
            d="M -150 -70 h 300 a 30 30 0 0 1 30 30 v 80 a 30 30 0 0 1 -30 30 h -220 l -60 50 l 10 -50 h -30 a 30 30 0 0 1 -30 -30 v -80 a 30 30 0 0 1 30 -30 Z"
            fill="#ffffff"
            stroke="#1c1917"
            strokeWidth={4}
          />
          {[0, 1, 2].map((index) => (
            <circle
              key={index}
              cx={-50 + index * 50}
              cy={0}
              r={14}
              fill="#1c1917"
              opacity={0.3 + Math.max(0, wave(frame, 24, 0.7, index / 3))}
            />
          ))}
        </g>
      );
    case "IDEA": {
      const glow = 0.25 + wave(frame, 20, 0.12);
      return (
        <g transform={`translate(${CHARACTER_X + 150} 250) scale(${grow})`}>
          <circle r={110} fill="#ffe066" opacity={glow} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <line
              key={index}
              x1={0}
              y1={-88}
              x2={0}
              y2={-120}
              stroke="#fab005"
              strokeWidth={8}
              strokeLinecap="round"
              transform={`rotate(${index * 45})`}
            />
          ))}
          <circle r={56} fill="#fff3bf" stroke="#1c1917" strokeWidth={5} />
          <rect x={-24} y={50} width={48} height={34} rx={6} fill="#adb5bd" stroke="#1c1917" strokeWidth={4} />
        </g>
      );
    }
    case "CELEBRATING":
      return (
        <g>
          {Array.from({ length: 22 }, (_, index) => {
            const x = ((index * 137) % 1000) + 40;
            const y = ((index * 211 + frame * 7) % 900) + 120;
            const colors = ["#f03e3e", "#1c7ed6", "#f59f00", "#37b24d", "#ae3ec9"];
            return (
              <rect
                key={index}
                x={x}
                y={y}
                width={18}
                height={10}
                fill={colors[index % colors.length]}
                transform={`rotate(${frame * 9 + index * 40} ${x + 9} ${y + 5})`}
              />
            );
          })}
        </g>
      );
    default:
      return null;
  }
}

// A desk in front of a seated character; the laptop screen flickers as if in use.
function Desk({ frame }: Readonly<{ frame: number }>) {
  return (
    <g>
      <rect x={300} y={FLOOR_Y - 150} width={480} height={26} rx={8} fill="#8d6e63" />
      <rect x={330} y={FLOOR_Y - 124} width={20} height={124} fill="#6d4c41" />
      <rect x={730} y={FLOOR_Y - 124} width={20} height={124} fill="#6d4c41" />
      <path
        d={`M 430 ${FLOOR_Y - 150} L 450 ${FLOOR_Y - 290} L 650 ${FLOOR_Y - 290} L 670 ${FLOOR_Y - 150} Z`}
        fill="#495057"
      />
      <path
        d={`M 462 ${FLOOR_Y - 165} L 476 ${FLOOR_Y - 274} L 624 ${FLOOR_Y - 274} L 638 ${FLOOR_Y - 165} Z`}
        fill="#74c0fc"
        opacity={0.8 + wave(frame, 9, 0.12)}
      />
    </g>
  );
}

// The animated picture behind a scene: scenery, the video's character doing the scene's action, and what goes with it.
// It fills the whole frame because it is decoration; the scene's words sit on an opaque card at the top of the safe
// zone, so the stage is moved down the frame and the character drawn larger beneath the card.
const STAGE_SHIFT = 540;
const CHARACTER_SCALE = 1.25;

export function IllustratedScene({ illustration, sceneId }: Readonly<{ illustration: Illustration; sceneId: string }>) {
  const frame = useCurrentFrame();
  const look = useCharacterLook();
  const { setting, action } = illustration;
  const enlarge = `translate(${CHARACTER_X} ${FLOOR_Y}) scale(${CHARACTER_SCALE}) translate(${-CHARACTER_X} ${-FLOOR_Y})`;
  return (
    <AbsoluteFill>
      <svg width="100%" height="100%" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g transform={`translate(0 ${STAGE_SHIFT})`}>
          <Backdrop setting={setting} frame={frame} id={`il-${sceneId}`} moving={action === "WALKING"} />
          <g transform={enlarge}>
            <ellipse cx={CHARACTER_X} cy={FLOOR_Y + 8} rx={120} ry={18} fill="#000000" opacity={0.12} />
            <g transform={`translate(${CHARACTER_X} ${FLOOR_Y})`}>
              <Character action={action} frame={frame} look={look} />
            </g>
            {action === "WORKING" ? <Desk frame={frame} /> : null}
            {action === "CELEBRATING" ? null : <ActionExtras action={action} frame={frame} />}
          </g>
        </g>
        {action === "CELEBRATING" ? <ActionExtras action={action} frame={frame} /> : null}
      </svg>
    </AbsoluteFill>
  );
}
