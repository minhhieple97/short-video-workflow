import { Composition } from "remotion";

import { PlaceholderComposition } from "./compositions/placeholder-composition";
import { CANVAS } from "./theme/tokens";

const PLACEHOLDER_DURATION_FRAMES = CANVAS.fps * 3;

export function RemotionRoot() {
  return (
    <Composition
      id="Placeholder"
      component={PlaceholderComposition}
      durationInFrames={PLACEHOLDER_DURATION_FRAMES}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
    />
  );
}
