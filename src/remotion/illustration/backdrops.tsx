import type { ReactNode } from "react";

import type { IllustrationSetting } from "@/features/videos/domain/illustration";

import { cycle, wave } from "./anim";

// Scenery drawn in canvas units (1080 wide) with the floor line at y = 1000, where the character stands; the scene
// shifts it down the frame and the wall or sky reaches SKY_EXTRA higher so the top is never empty. Only fills, strokes,
// gradients and transforms: no filters or blur, which are slow to rasterise in a headless browser.
export const FLOOR_Y = 1000;
export const SKY_EXTRA = 700;

interface BackdropProps {
  frame: number;
  // A unique prefix for gradient and clip ids, since several scenes may be in the page at once.
  id: string;
  // The character is walking: the scenery slides past.
  moving: boolean;
}

function Vertical({ id, top, bottom }: Readonly<{ id: string; top: string; bottom: string }>) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={top} />
      <stop offset="1" stopColor={bottom} />
    </linearGradient>
  );
}

function Cloud({ x, y, scale = 1 }: Readonly<{ x: number; y: number; scale?: number }>) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="#ffffff" opacity={0.92}>
      <ellipse cx={0} cy={0} rx={90} ry={44} />
      <ellipse cx={-62} cy={14} rx={56} ry={34} />
      <ellipse cx={66} cy={12} rx={60} ry={36} />
    </g>
  );
}

// Scenery that loops sideways: drawn twice, one canvas width apart, so the seam never shows.
function Scrolling({ offset, children }: Readonly<{ offset: number; children: ReactNode }>) {
  return (
    <g transform={`translate(${-offset} 0)`}>
      {children}
      <g transform="translate(1080 0)">{children}</g>
    </g>
  );
}

function Floor({ color, line }: Readonly<{ color: string; line: string }>) {
  return (
    <g>
      <rect x={0} y={FLOOR_Y} width={1080} height={920} fill={color} />
      {[0, 1, 2, 3].map((index) => (
        <line
          key={index}
          x1={0}
          y1={FLOOR_Y + 70 + index * 110}
          x2={1080}
          y2={FLOOR_Y + 70 + index * 110}
          stroke={line}
          strokeWidth={4}
        />
      ))}
    </g>
  );
}

function Home({ frame, id }: Readonly<BackdropProps>) {
  const cloudX = cycle(frame, 360) * 460 - 80;
  return (
    <g>
      <defs>
        <Vertical id={`${id}-wall`} top="#fdebd3" bottom="#f8cfa4" />
        <clipPath id={`${id}-window`}>
          <rect x={96} y={330} width={318} height={288} />
        </clipPath>
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-wall)`} />
      <rect x={96} y={330} width={318} height={288} fill="#bfe6ff" />
      <g clipPath={`url(#${id}-window)`}>
        <Cloud x={cloudX} y={420} scale={0.7} />
      </g>
      <rect x={90} y={324} width={330} height={300} fill="none" stroke="#ffffff" strokeWidth={14} />
      <line x1={255} y1={324} x2={255} y2={624} stroke="#ffffff" strokeWidth={10} />
      <Floor color="#c99a6e" line="#b9875a" />
      <g>
        <rect x={720} y={760} width={330} height={110} rx={34} fill="#5b7cfa" />
        <rect x={700} y={850} width={370} height={150} rx={34} fill="#4c6ef5" />
        <rect x={700} y={960} width={30} height={40} fill="#364fc7" />
        <rect x={1040} y={960} width={30} height={40} fill="#364fc7" />
      </g>
      <g>
        <rect x={56} y={900} width={70} height={100} rx={10} fill="#d9480f" />
        <ellipse cx={91} cy={872} rx={58} ry={46} fill="#2f9e44" />
        <ellipse cx={70} cy={840} rx={30} ry={40} fill="#37b24d" transform={`rotate(${wave(frame, 80, 3)} 91 900)`} />
      </g>
    </g>
  );
}

function Office({ frame, id }: Readonly<BackdropProps>) {
  const minute = (frame * 2) % 360;
  return (
    <g>
      <defs>
        <Vertical id={`${id}-wall`} top="#eef3fc" bottom="#d7e3f7" />
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-wall)`} />
      <rect x={640} y={300} width={360} height={330} fill="#cfe8ff" />
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <rect key={index} x={640} y={300 + index * 47} width={360} height={14} fill="#adb5bd" />
      ))}
      <g transform="translate(240 380)">
        <circle r={70} fill="#ffffff" stroke="#495057" strokeWidth={10} />
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={-48}
          stroke="#212529"
          strokeWidth={8}
          strokeLinecap="round"
          transform={`rotate(${minute})`}
        />
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={-30}
          stroke="#212529"
          strokeWidth={10}
          strokeLinecap="round"
          transform={`rotate(${minute / 12 + 120})`}
        />
      </g>
      <g>
        <rect x={50} y={560} width={250} height={440} fill="#8d6e63" />
        {[0, 1, 2].map((shelf) => (
          <g key={shelf}>
            <rect x={50} y={680 + shelf * 120} width={250} height={14} fill="#6d4c41" />
            {[0, 1, 2, 3, 4].map((book) => (
              <rect
                key={book}
                x={66 + book * 44}
                y={600 + shelf * 120}
                width={34}
                height={80}
                fill={["#f03e3e", "#1c7ed6", "#f59f00", "#37b24d", "#7048e8"][(book + shelf) % 5]}
              />
            ))}
          </g>
        ))}
      </g>
      <Floor color="#aab4c3" line="#98a3b3" />
    </g>
  );
}

function Street({ frame, id, moving }: Readonly<BackdropProps>) {
  const far = moving ? (frame * 1.5) % 1080 : 0;
  const near = moving ? (frame * 4) % 1080 : 0;
  const cloudX = cycle(frame, 600) * 1300 - 150;
  return (
    <g>
      <defs>
        <Vertical id={`${id}-sky`} top="#8fd0ff" bottom="#e7f5ff" />
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-sky)`} />
      <circle cx={880} cy={300} r={78} fill="#ffd43b" />
      <Cloud x={cloudX} y={360} />
      <Cloud x={((cloudX + 600) % 1300) - 150} y={250} scale={0.7} />
      <Scrolling offset={far}>
        {[0, 1, 2, 3, 4].map((index) => (
          <rect key={index} x={index * 230} y={560 + (index % 2) * 80} width={190} height={440} fill="#a5b4c8" />
        ))}
      </Scrolling>
      <Scrolling offset={near}>
        {[0, 1, 2].map((index) => (
          <g key={index}>
            <rect
              x={60 + index * 380}
              y={640}
              width={260}
              height={360}
              fill={["#e07a5f", "#3d405b", "#81b29a"][index]}
            />
            {[0, 1, 2].map((row) =>
              [0, 1, 2].map((column) => (
                <rect
                  key={`${row}-${column}`}
                  x={90 + index * 380 + column * 75}
                  y={680 + row * 95}
                  width={44}
                  height={56}
                  fill="#fff3bf"
                />
              )),
            )}
          </g>
        ))}
      </Scrolling>
      <rect x={0} y={FLOOR_Y} width={1080} height={920} fill="#ced4da" />
      <rect x={0} y={FLOOR_Y} width={1080} height={22} fill="#adb5bd" />
      <g>
        <rect x={960} y={620} width={16} height={380} fill="#495057" />
        <ellipse cx={968} cy={612} rx={46} ry={22} fill="#343a40" />
        <ellipse cx={968} cy={630} rx={30} ry={12} fill="#ffe066" opacity={0.7 + wave(frame, 50, 0.2)} />
      </g>
    </g>
  );
}

function Park({ frame, id, moving }: Readonly<BackdropProps>) {
  const birdsX = cycle(frame, 300) * 1300 - 120;
  const flap = wave(frame, 10, 12);
  const scroll = moving ? (frame * 3) % 1080 : 0;
  return (
    <g>
      <defs>
        <Vertical id={`${id}-sky`} top="#a5d8ff" bottom="#f1f9ff" />
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-sky)`} />
      <g transform={`translate(860 290) rotate(${frame * 0.6})`}>
        {[0, 45, 90, 135].map((angle) => (
          <rect
            key={angle}
            x={-6}
            y={-120}
            width={12}
            height={240}
            rx={6}
            fill="#ffe066"
            transform={`rotate(${angle})`}
          />
        ))}
        <circle r={70} fill="#fcc419" />
      </g>
      <g stroke="#343a40" strokeWidth={5} fill="none" strokeLinecap="round">
        <path d={`M ${birdsX} 330 q 20 ${-flap} 40 0 q 20 ${-flap} 40 0`} />
        <path d={`M ${birdsX - 110} 390 q 16 ${flap} 32 0 q 16 ${flap} 32 0`} />
      </g>
      <ellipse cx={250} cy={1010} rx={520} ry={150} fill="#69db7c" />
      <ellipse cx={900} cy={1020} rx={480} ry={130} fill="#51cf66" />
      <Scrolling offset={scroll}>
        {[140, 900].map((x) => (
          <g key={x}>
            <rect x={x - 18} y={760} width={36} height={240} fill="#8d5524" />
            <g transform={`rotate(${wave(frame, 70, 2, x / 1000)} ${x} 760)`}>
              <circle cx={x} cy={690} r={110} fill="#2b8a3e" />
              <circle cx={x - 70} cy={740} r={70} fill="#2f9e44" />
              <circle cx={x + 70} cy={740} r={70} fill="#37b24d" />
            </g>
          </g>
        ))}
      </Scrolling>
      <rect x={0} y={FLOOR_Y} width={1080} height={920} fill="#8ce99a" />
      <rect x={0} y={FLOOR_Y} width={1080} height={20} fill="#69db7c" />
    </g>
  );
}

function Cafe({ frame, id }: Readonly<BackdropProps>) {
  const steam = cycle(frame, 45);
  return (
    <g>
      <defs>
        <Vertical id={`${id}-wall`} top="#f8e9d2" bottom="#efd5b0" />
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-wall)`} />
      <rect x={0} y={760} width={1080} height={240} fill="#c08552" />
      <rect x={80} y={300} width={300} height={220} rx={12} fill="#343a40" />
      {[0, 1, 2].map((row) => (
        <rect
          key={row}
          x={110}
          y={340 + row * 56}
          width={180 - row * 30}
          height={14}
          rx={7}
          fill="#f8f9fa"
          opacity={0.85}
        />
      ))}
      {[260, 820].map((x, index) => (
        <g key={x} transform={`rotate(${wave(frame, 90, 4, index * 0.3)} ${x} 0)`}>
          <line x1={x} y1={0} x2={x} y2={230} stroke="#495057" strokeWidth={6} />
          <path d={`M ${x - 70} 290 L ${x - 30} 230 L ${x + 30} 230 L ${x + 70} 290 Z`} fill="#f59f00" />
          <ellipse cx={x} cy={296} rx={40} ry={14} fill="#fff3bf" opacity={0.8} />
        </g>
      ))}
      <Floor color="#8d6748" line="#7a573b" />
      <g>
        <rect x={780} y={880} width={220} height={20} rx={8} fill="#5c3d2e" />
        <rect x={880} y={900} width={20} height={100} fill="#5c3d2e" />
        <rect x={840} y={830} width={56} height={50} rx={8} fill="#ffffff" stroke="#adb5bd" strokeWidth={4} />
        {[0, 1, 2].map((index) => (
          <path
            key={index}
            d={`M ${852 + index * 14} ${820 - steam * 60} q 10 -20 0 -40 q -10 -20 0 -40`}
            fill="none"
            stroke="#ced4da"
            strokeWidth={6}
            strokeLinecap="round"
            opacity={1 - steam}
          />
        ))}
      </g>
    </g>
  );
}

function Classroom({ frame, id }: Readonly<BackdropProps>) {
  const drawn = (start: number) => Math.max(0, 600 - (frame - start) * 18);
  return (
    <g>
      <defs>
        <Vertical id={`${id}-wall`} top="#eaf6ec" bottom="#d3ecd7" />
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-wall)`} />
      <rect x={110} y={250} width={860} height={400} rx={14} fill="#a47148" />
      <rect x={130} y={270} width={820} height={360} rx={8} fill="#2f5d50" />
      <g stroke="#f1f3f5" strokeWidth={8} strokeLinecap="round" fill="none" strokeDasharray={600}>
        <path d="M 180 340 L 620 340" strokeDashoffset={drawn(4)} />
        <path d="M 180 420 L 520 420" strokeDashoffset={drawn(20)} />
        <path d="M 180 500 L 580 500" strokeDashoffset={drawn(36)} />
        <path d="M 760 470 a 70 70 0 1 1 1 0" strokeDashoffset={drawn(50)} />
      </g>
      <Floor color="#c8b08a" line="#b89c72" />
    </g>
  );
}

function NightRoom({ frame, id }: Readonly<BackdropProps>) {
  const stars = [
    [150, 360],
    [260, 420],
    [330, 330],
    [200, 520],
    [390, 480],
  ] as const;
  return (
    <g>
      <defs>
        <Vertical id={`${id}-wall`} top="#2b3358" bottom="#1f2544" />
      </defs>
      <rect y={-SKY_EXTRA} width={1080} height={FLOOR_Y + SKY_EXTRA} fill={`url(#${id}-wall)`} />
      <rect x={100} y={300} width={340} height={300} fill="#0b1026" />
      {stars.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={6} fill="#fff9db" opacity={0.5 + wave(frame, 40, 0.5, index * 0.21)} />
      ))}
      <circle cx={360} cy={370} r={34} fill="#fff3bf" />
      <circle cx={376} cy={360} r={30} fill="#0b1026" />
      <rect x={94} y={294} width={352} height={312} fill="none" stroke="#495057" strokeWidth={12} />
      <Floor color="#3b2f4a" line="#33283f" />
      <g>
        <rect x={700} y={840} width={300} height={20} fill="#5f3dc4" />
        <rect x={940} y={700} width={10} height={140} fill="#868e96" />
        <path d="M 900 700 L 990 700 L 970 650 L 920 650 Z" fill="#fab005" />
        <circle cx={945} cy={760} r={110} fill="#ffe066" opacity={0.16 + wave(frame, 60, 0.04)} />
      </g>
    </g>
  );
}

const BACKDROPS: Record<IllustrationSetting, (props: BackdropProps) => ReactNode> = {
  HOME: Home,
  OFFICE: Office,
  STREET: Street,
  PARK: Park,
  CAFE: Cafe,
  CLASSROOM: Classroom,
  NIGHT_ROOM: NightRoom,
};

export function Backdrop({ setting, ...props }: Readonly<BackdropProps & { setting: IllustrationSetting }>) {
  const Draw = BACKDROPS[setting];
  return <Draw {...props} />;
}
