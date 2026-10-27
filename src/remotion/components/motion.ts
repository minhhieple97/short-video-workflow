import { interpolate, spring } from "remotion";

export function enter(frame: number, fps: number, delay = 0) {
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });
  return {
    opacity: interpolate(progress, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(progress, [0, 1], [40, 0])}px)`,
  };
}

// Hook text must be fully readable at frame 0, so only a subtle scale is animated.
export function hookPop(frame: number, fps: number) {
  const progress = spring({ frame, fps, config: { damping: 14, stiffness: 120 }, durationInFrames: 20 });
  return { opacity: 1, transform: `scale(${interpolate(progress, [0, 1], [0.94, 1])})` };
}
