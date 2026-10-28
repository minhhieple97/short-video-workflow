import { describe, expect, it } from "vitest";

import {
  DURATION_PRESETS_SEC,
  formatPreset,
  isDurationPreset,
  isLongPreset,
  MAX_TARGET_SEC,
} from "@/features/videos/domain/duration";

describe("duration presets", () => {
  it("go from 30 seconds to five minutes, the long ones beyond a minute", () => {
    expect(DURATION_PRESETS_SEC).toEqual([30, 45, 60, 90, 120, 180, 240, 300]);
    expect(MAX_TARGET_SEC).toBe(300);
    expect(DURATION_PRESETS_SEC.filter(isLongPreset)).toEqual([90, 120, 180, 240, 300]);
    expect(isDurationPreset(150)).toBe(false);
  });

  it("are named in seconds under two minutes and in minutes from there", () => {
    expect([30, 90, 120, 300].map(formatPreset)).toEqual(["30 giây", "90 giây", "2 phút", "5 phút"]);
  });
});
