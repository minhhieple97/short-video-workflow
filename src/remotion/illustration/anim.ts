// Frame-driven motion only: the same frame always draws the same picture, so preview, draft and final renders agree.
export function wave(frame: number, period: number, amplitude: number, phase = 0): number {
  return Math.sin((frame / period + phase) * Math.PI * 2) * amplitude;
}

// 0 → 1 over each period, then again.
export function cycle(frame: number, period: number): number {
  return (((frame % period) + period) % period) / period;
}

// Eyes close for three frames about every three seconds; the offset keeps several characters from blinking together.
export function eyeOpen(frame: number, offset = 0): number {
  return (frame + offset) % 96 < 3 ? 0.12 : 1;
}

// Grows from nothing over the first frames of a scene, without overshoot.
export function appear(frame: number, frames = 12): number {
  return Math.min(1, Math.max(0, frame / frames));
}
