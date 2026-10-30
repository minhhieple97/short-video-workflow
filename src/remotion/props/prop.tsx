import { memo } from "react";

import type { PropId } from "@/features/videos/domain/props";

import { PROP_ART } from "./prop-art.generated";

// A prop drawn as an SVG group of `size` pixels with its top-left corner at (x, y), in the caller's SVG coordinates.
export const Prop = memo(function Prop({ id, x, y, size }: { id: PropId; x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 32})`}>
      {PROP_ART[id].map((shape, index) => {
        switch (shape[0]) {
          case "p":
            return (
              <path
                key={index}
                d={shape[1]}
                fill={shape[2]}
                fillRule={shape[3] === 1 ? "evenodd" : undefined}
                opacity={shape[4] === 1 ? undefined : shape[4]}
              />
            );
          case "r":
            return (
              <rect
                key={index}
                x={shape[1]}
                y={shape[2]}
                width={shape[3]}
                height={shape[4]}
                rx={shape[5]}
                fill={shape[6]}
              />
            );
          case "c":
            return <circle key={index} cx={shape[1]} cy={shape[2]} r={shape[3]} fill={shape[4]} />;
          case "e":
            return (
              <ellipse
                key={index}
                cx={shape[1]}
                cy={shape[2]}
                rx={shape[3]}
                ry={shape[4]}
                fill={shape[5]}
                transform={shape[6] || undefined}
              />
            );
        }
      })}
    </g>
  );
});
