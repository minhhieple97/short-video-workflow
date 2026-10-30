import { memo } from "react";

import type { PeepPath } from "./peep-art-types";
import { PEEP_ART } from "./peeps-art.generated";

export type PeepBodyName = keyof typeof PEEP_ART.bodies;
export type PeepFaceName = keyof typeof PEEP_ART.faces;
export type PeepHairName = keyof typeof PEEP_ART.hair;
export type PeepAccessoryName = keyof typeof PEEP_ART.accessories;
export type PeepFacialHairName = keyof typeof PEEP_ART.facialHair;

export interface PeepLook {
  hair: PeepHairName;
  accessory?: PeepAccessoryName;
  facialHair?: PeepFacialHairName;
  line: string;
  fill: string;
}

export interface PeepFigureProps {
  body: PeepBodyName;
  face: PeepFaceName;
  look: PeepLook;
}

// Where the head pieces sit relative to the body art (the layout Open Peeps is drawn for).
const HEAD = { hair: [225, 0], face: [384, 186], facialHair: [348, 338], accessory: [272, 241] } as const;
const HEAD_BOUNDS = [150, -90, 900, 560] as const;

// The whole figure's box in the art's own coordinates: the body plus the head, which hair can push above y = 0.
export function peepBounds(body: PeepBodyName): { x: number; y: number; width: number; height: number } {
  const [minX, minY, maxX, maxY] = PEEP_ART.bodies[body].bounds;
  const x = Math.min(minX, HEAD_BOUNDS[0]);
  const y = Math.min(minY, HEAD_BOUNDS[1]);
  return { x, y, width: Math.max(maxX, HEAD_BOUNDS[2]) - x, height: Math.max(maxY, HEAD_BOUNDS[3]) - y };
}

const Piece = memo(function Piece({
  paths,
  at,
  line,
  fill,
}: {
  paths: readonly PeepPath[];
  at: readonly [number, number];
  line: string;
  fill: string;
}) {
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      {paths.map(([d, paint, dx, dy, evenOdd], index) => (
        <path
          key={index}
          d={d}
          transform={dx === 0 && dy === 0 ? undefined : `translate(${dx} ${dy})`}
          fill={paint === 0 ? line : fill}
          fillRule={evenOdd === 1 ? "evenodd" : undefined}
        />
      ))}
    </g>
  );
});

// One Open Peeps figure as an SVG group in the art's coordinates; the caller places and scales it. Pieces are fixed data,
// so the same props always draw the same picture.
export const PeepFigure = memo(function PeepFigure({ body, face, look }: PeepFigureProps) {
  const { line, fill } = look;
  return (
    <g>
      <Piece paths={PEEP_ART.bodies[body].paths} at={[0, 0]} line={line} fill={fill} />
      <Piece paths={PEEP_ART.hair[look.hair]} at={HEAD.hair} line={line} fill={fill} />
      <Piece paths={PEEP_ART.faces[face]} at={HEAD.face} line={line} fill={fill} />
      {look.facialHair ? (
        <Piece paths={PEEP_ART.facialHair[look.facialHair]} at={HEAD.facialHair} line={line} fill={fill} />
      ) : null}
      {look.accessory ? (
        <Piece paths={PEEP_ART.accessories[look.accessory]} at={HEAD.accessory} line={line} fill={fill} />
      ) : null}
    </g>
  );
});
