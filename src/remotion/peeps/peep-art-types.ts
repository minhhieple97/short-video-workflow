// A path of a piece: its data, whether it is painted with the line or the fill colour, its offset and its fill rule.
export type PeepPath = readonly [d: string, paint: 0 | 1, dx: number, dy: number, evenOdd: 0 | 1];

export interface PeepBody {
  readonly kind: "bust" | "standing" | "sitting";
  // [minX, minY, maxX, maxY] in the shared head-anchored coordinates.
  readonly bounds: readonly [number, number, number, number];
  readonly paths: readonly PeepPath[];
}

export interface PeepArt {
  readonly bodies: Readonly<Record<string, PeepBody>>;
  readonly faces: Readonly<Record<string, readonly PeepPath[]>>;
  readonly hair: Readonly<Record<string, readonly PeepPath[]>>;
  readonly accessories: Readonly<Record<string, readonly PeepPath[]>>;
  readonly facialHair: Readonly<Record<string, readonly PeepPath[]>>;
}
