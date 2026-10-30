import { useCurrentFrame } from "remotion";

import { peepBounds, PeepFigure, type PeepFigureProps } from "../peeps/peep";

// A Peep standing on the stage: `x` is the horizontal centre and `bottom` where its art ends, both in stage pixels; `height`
// is the drawn height of the whole figure. Breathing is a slow, small scale on the body so a held shot never looks frozen.
export function PeepActor({
  x,
  bottom,
  height,
  flip = false,
  breathe = true,
  ...figure
}: PeepFigureProps & { x: number; bottom: number; height: number; flip?: boolean; breathe?: boolean }) {
  const frame = useCurrentFrame();
  const box = peepBounds(figure.body);
  const scale = height / box.height;
  const width = box.width * scale;
  const breath = breathe ? 1 + Math.sin(frame / 22) * 0.006 : 1;
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={width}
      height={height}
      style={{
        position: "absolute",
        left: x - width / 2,
        top: bottom - height,
        overflow: "visible",
        transformOrigin: "50% 100%",
        transform: `${flip ? "scaleX(-1) " : ""}scaleY(${breath})`,
      }}
    >
      <PeepFigure {...figure} />
    </svg>
  );
}
