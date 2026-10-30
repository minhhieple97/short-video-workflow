import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

// Where the camera looks: a point of the 1080×1920 stage and how close it is.
export interface CameraFraming {
  x: number;
  y: number;
  zoom: number;
}

// The screen point the framed point lands on: the middle of the picture band, between the headline (above 620) and the
// captions (below 1260), centred in the safe area.
const ANCHOR = { x: 486, y: 950 } as const;

function transformFor({ x, y, zoom }: CameraFraming): string {
  return `translate(${ANCHOR.x - x * zoom}px, ${ANCHOR.y - y * zoom}px) scale(${zoom})`;
}

// Frames the stage on `from` and eases to `to` over `durationInFrames` (a slow push or pan; changes of shot size are cuts,
// never zooms). Every move is a pure function of the frame.
export function Camera({
  from,
  to = from,
  durationInFrames,
  children,
}: {
  from: CameraFraming;
  to?: CameraFraming;
  durationInFrames: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const framing = {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    zoom: from.zoom + (to.zoom - from.zoom) * progress,
  };
  return (
    <div
      style={{
        position: "absolute",
        width: 1080,
        height: 1920,
        transformOrigin: "0 0",
        transform: transformFor(framing),
      }}
    >
      {children}
    </div>
  );
}

// The framing that shows the whole 1080×1920 stage unscaled.
export const WIDE_FRAMING: CameraFraming = { x: ANCHOR.x, y: ANCHOR.y, zoom: 1 };
