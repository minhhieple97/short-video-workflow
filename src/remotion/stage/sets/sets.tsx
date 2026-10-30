import type { ComponentType, ReactNode } from "react";
import { useCurrentFrame } from "remotion";

import type { IllustrationSetting } from "@/features/videos/domain/illustration";

import { Prop } from "../../props/prop";
import { Clouds, Counter, DayWindow, NightWindow, Shelf, WallClock } from "./pieces";

export interface SetSpec {
  // Behind everything, also what shows when the camera frames past the edge.
  background: string;
  // A dark set takes light headline text.
  dark: boolean;
  Back: ComponentType;
  // In front of a half-body character (it hides where the art ends).
  Front: ComponentType;
  // Under a full-body character: only the ground, so the legs show.
  Ground: ComponentType;
}

const STAGE = { viewBox: "0 0 1080 1920", style: { position: "absolute", inset: 0 } } as const;

function Layer({ children }: { children: ReactNode }) {
  return <svg {...STAGE}>{children}</svg>;
}

function HomeBack() {
  return (
    <Layer>
      <rect width="1080" height="1920" fill="#FBE7D3" />
      <rect y="1040" width="1080" height="160" fill="#F5D5B8" />
      <rect y="1036" width="1080" height="10" fill="#EBC3A0" />
      <DayWindow x={640} y={640} width={270} height={320} />
      <Shelf x={60} y={880} width={340} color="#B07448" items={["BOOKS", "POTTED_PLANT"]} />
    </Layer>
  );
}

function OfficeBack() {
  const frame = useCurrentFrame();
  return (
    <Layer>
      <rect width="1080" height="1920" fill="#E8EEF5" />
      <rect y="1040" width="1080" height="160" fill="#D9E2EE" />
      <g transform="translate(630 640)">
        <rect x="-10" y="-10" width="300" height="340" rx="16" fill="#FFFFFF" />
        <rect width="280" height="320" rx="8" fill="#CFE8F7" />
        {Array.from({ length: 11 }, (_, index) => (
          <rect key={index} y={index * 30 + 6} width="280" height="16" fill="#FFFFFF" opacity="0.75" />
        ))}
      </g>
      <WallClock x={200} y={720} r={62} frame={frame} />
      <Shelf x={60} y={930} width={360} color="#9AA7B8" items={["BOOKS", "BRIEFCASE"]} />
    </Layer>
  );
}

function CafeBack() {
  const frame = useCurrentFrame();
  const swing = Math.sin(frame / 28) * 4;
  return (
    <Layer>
      <rect width="1080" height="1920" fill="#F3E0C8" />
      <rect y="990" width="1080" height="210" fill="#E4B48C" />
      {Array.from({ length: 6 }, (_, row) => (
        <rect key={row} y={1000 + row * 34} width="1080" height="3" fill="#CF9A72" />
      ))}
      <g transform="translate(90 640)">
        <rect x="-12" y="-12" width="344" height="314" rx="14" fill="#8B5E3C" />
        <rect width="320" height="290" rx="8" fill="#2F3A33" />
        {[40, 90, 140, 190, 240].map((y, index) => (
          <rect
            key={y}
            x="30"
            y={y}
            width={index % 2 === 0 ? 210 : 160}
            height="10"
            rx="5"
            fill="#FFFFFF"
            opacity="0.7"
          />
        ))}
      </g>
      {[720, 900].map((x, index) => (
        <g key={x} transform={`rotate(${index === 0 ? swing : -swing} ${x} 0)`}>
          <rect x={x - 3} y="0" width="6" height="640" fill="#2F3A33" />
          <circle cx={x} cy="700" r="70" fill="#FFE0A3" opacity="0.35" />
          <path d={`M ${x - 55} 700 Q ${x} 620 ${x + 55} 700 Z`} fill="#2F3A33" />
          <circle cx={x} cy="702" r="14" fill="#FFE0A3" />
        </g>
      ))}
      <Shelf x={640} y={930} width={360} color="#8B5E3C" items={["TEACUP", "POTTED_PLANT"]} />
    </Layer>
  );
}

function ClassroomBack() {
  return (
    <Layer>
      <rect width="1080" height="1920" fill="#FFF2D4" />
      <rect y="1040" width="1080" height="160" fill="#F7E2B6" />
      <rect x="40" y="630" width="1000" height="380" rx="14" fill="#B07448" />
      <rect x="58" y="648" width="964" height="344" rx="8" fill="#2F5D50" />
      {[
        [100, 700, 220],
        [100, 760, 160],
        [100, 820, 250],
        [760, 700, 200],
        [760, 760, 150],
      ].map(([x = 0, y = 0, width = 0]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={width} height="12" rx="6" fill="#FFFFFF" opacity="0.65" />
      ))}
      <rect x="100" y="1000" width="880" height="14" rx="7" fill="#8E5634" />
    </Layer>
  );
}

function NightRoomBack() {
  return (
    <Layer>
      <rect width="1080" height="1920" fill="#2D2E5C" />
      <rect y="1040" width="1080" height="160" fill="#26274F" />
      <NightWindow x={640} y={640} width={270} height={320} />
      <Shelf x={60} y={880} width={340} color="#4A3B6E" items={["BOOKS", "POTTED_PLANT"]} />
      <circle cx="170" cy="1120" r="230" fill="#FFD98A" opacity="0.12" />
      <circle cx="170" cy="1120" r="140" fill="#FFD98A" opacity="0.14" />
    </Layer>
  );
}

function SkyBack({ ground }: { ground: "street" | "park" }) {
  return (
    <>
      <defs>
        <linearGradient id={`sky-${ground}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A9DDF7" />
          <stop offset="1" stopColor="#E9F7FF" />
        </linearGradient>
      </defs>
      <rect width="1080" height="1920" fill={`url(#sky-${ground})`} />
      <circle cx="880" cy="700" r="70" fill="#FFD34E" />
      <Clouds y={760} />
    </>
  );
}

function StreetBack() {
  const frame = useCurrentFrame();
  const busX = 1100 - ((frame * 4) % 1500);
  const buildings = [
    [0, 820, 220, "#F6D2B5"],
    [210, 760, 200, "#C9D7F2"],
    [400, 860, 230, "#F0B9A0"],
    [620, 740, 210, "#E7C1E8"],
    [820, 800, 260, "#F6D2B5"],
  ] as const;
  return (
    <Layer>
      <SkyBack ground="street" />
      {buildings.map(([x, top, width, color]) => (
        <g key={x}>
          <rect x={x} y={top} width={width} height={1200 - top} fill={color} />
          {Array.from({ length: 3 }, (_, row) =>
            Array.from({ length: 3 }, (_, column) => (
              <rect
                key={`${row}-${column}`}
                x={x + 30 + column * ((width - 60) / 3)}
                y={top + 40 + row * 90}
                width={(width - 60) / 3 - 20}
                height="56"
                rx="6"
                fill="#FFFFFF"
                opacity="0.55"
              />
            )),
          )}
        </g>
      ))}
      <rect y="1120" width="1080" height="80" fill="#8D96A8" />
      <Prop id="BUS" x={busX} y={960} size={200} />
      <rect x="930" y="760" width="14" height="440" fill="#4A5160" />
      <rect x="900" y="740" width="74" height="30" rx="12" fill="#4A5160" />
    </Layer>
  );
}

function ParkBack() {
  return (
    <Layer>
      <SkyBack ground="park" />
      <ellipse cx="250" cy="1180" rx="520" ry="260" fill="#BFE3A6" />
      <ellipse cx="880" cy="1200" rx="520" ry="240" fill="#A9D98F" />
      <Prop id="TREE" x={-20} y={760} size={330} />
      <Prop id="PINE_TREE" x={780} y={800} size={300} />
    </Layer>
  );
}

function Ground({ fill, line }: { fill: string; line?: string }) {
  return (
    <Layer>
      <rect y="1240" width="1080" height="680" fill={fill} />
      {line ? <rect y="1240" width="1080" height="10" fill={line} /> : null}
    </Layer>
  );
}

function Bushes() {
  return (
    <Layer>
      <rect y="1250" width="1080" height="670" fill="#7CC873" />
      {Array.from({ length: 9 }, (_, index) => (
        <circle
          key={index}
          cx={index * 135}
          cy={1235 + (index % 2) * 20}
          r={95}
          fill={index % 2 ? "#5AAE58" : "#6DBE6A"}
        />
      ))}
    </Layer>
  );
}

function StreetWall() {
  return (
    <Layer>
      <rect y="1180" width="1080" height="34" fill="#E9A08A" />
      <rect y="1214" width="1080" height="110" fill="#D9826B" />
      {Array.from({ length: 3 }, (_, row) => (
        <rect key={row} y={1214 + row * 36} width="1080" height="3" fill="#C26B56" />
      ))}
      <rect y="1324" width="1080" height="596" fill="#CFC6BD" />
    </Layer>
  );
}

const desk = (top: string, edge: string, front: string, items: Parameters<typeof Counter>[0]["items"]) =>
  function Desk() {
    return (
      <Layer>
        <Counter top={top} edge={edge} front={front} items={items} />
      </Layer>
    );
  };

export const SETS: Record<IllustrationSetting, SetSpec> = {
  HOME: {
    background: "#FBE7D3",
    dark: false,
    Back: HomeBack,
    Front: desk("#D99A6C", "#B97850", "#A86C42", [
      { id: "ALARM_CLOCK", x: 80, size: 110 },
      { id: "TEACUP", x: 800, size: 110 },
    ]),
    Ground: () => <Ground fill="#E2B48D" line="#C99A73" />,
  },
  OFFICE: {
    background: "#E8EEF5",
    dark: false,
    Back: OfficeBack,
    Front: desk("#F1F3F6", "#C9D1DB", "#9AA7B8", [
      { id: "MEMO", x: 90, size: 110 },
      { id: "HOT_BEVERAGE", x: 800, size: 120 },
    ]),
    Ground: () => <Ground fill="#B8C3D1" line="#9AA7B8" />,
  },
  STREET: {
    background: "#E9F7FF",
    dark: false,
    Back: StreetBack,
    Front: StreetWall,
    Ground: () => <Ground fill="#CFC6BD" line="#B5ABA0" />,
  },
  PARK: {
    background: "#E9F7FF",
    dark: false,
    Back: ParkBack,
    Front: Bushes,
    Ground: () => <Ground fill="#7CC873" line="#6DBE6A" />,
  },
  CAFE: {
    background: "#F3E0C8",
    dark: false,
    Back: CafeBack,
    Front: desk("#9C6B52", "#7A5240", "#6B4434", [
      { id: "CAKE", x: 90, size: 110 },
      { id: "HOT_BEVERAGE", x: 810, size: 120 },
    ]),
    Ground: () => <Ground fill="#B98A68" line="#9C6B52" />,
  },
  CLASSROOM: {
    background: "#FFF2D4",
    dark: false,
    Back: ClassroomBack,
    Front: desk("#E3B57E", "#C99B62", "#C08A55", [
      { id: "NOTEBOOK", x: 80, size: 110 },
      { id: "BOOKS", x: 810, size: 120 },
    ]),
    Ground: () => <Ground fill="#E7C695" line="#C99B62" />,
  },
  NIGHT_ROOM: {
    background: "#2D2E5C",
    dark: true,
    Back: NightRoomBack,
    Front: desk("#5C4A40", "#4A3B33", "#3E312A", [
      { id: "LIGHT_BULB", x: 90, size: 110 },
      { id: "HOT_BEVERAGE", x: 810, size: 120 },
    ]),
    Ground: () => <Ground fill="#3E312A" line="#4A3B33" />,
  },
};
