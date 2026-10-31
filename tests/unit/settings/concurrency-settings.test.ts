import { describe, expect, it } from "vitest";

import {
  CONCURRENCY_KEYS,
  CONCURRENCY_SETTINGS,
  concurrencyForLane,
  resolveConcurrency,
} from "@/features/settings/domain/concurrency-settings";
import { concurrencySettingsSchema } from "@/features/settings/schemas/concurrency-settings.schema";
import { GENERAL_LANE_CONCURRENCY } from "@/shared/types/work-lane";

const DEFAULTS = {
  claude: 1,
  notebooklm: 2,
  voice: 1,
  render: 1,
  renderThreads: 1,
  archive: 2,
  extraction: 1,
};

describe("concurrency settings", () => {
  it("keeps the heavy work at one at a time and lets Drive and NotebookLM run two by default", () => {
    expect(resolveConcurrency([])).toEqual(DEFAULTS);
  });

  it("takes stored values over the defaults and ignores unknown keys and values out of range", () => {
    expect(
      resolveConcurrency([
        { key: "render", value: 3 },
        { key: "archive", value: 5 },
        { key: "voice", value: 0 },
        { key: "claude", value: 9 },
        { key: "renderThreads", value: 16 },
        { key: "retired-lane", value: 4 },
      ]),
    ).toEqual({ ...DEFAULTS, render: 3, archive: 5, renderThreads: 16 });
  });

  it("gives the general lane its fixed number and every other lane its setting", () => {
    const settings = { ...DEFAULTS, notebooklm: 3 };
    expect(concurrencyForLane(settings, "general")).toBe(GENERAL_LANE_CONCURRENCY);
    expect(concurrencyForLane(settings, "notebooklm")).toBe(3);
    expect(concurrencyForLane(settings, "render")).toBe(1);
  });

  it("lists every setting once, each with a label, an explanation and a sane range", () => {
    expect(new Set(CONCURRENCY_KEYS).size).toBe(Object.keys(CONCURRENCY_SETTINGS).length);
    for (const key of CONCURRENCY_KEYS) {
      const setting = CONCURRENCY_SETTINGS[key];
      expect(setting.label.length).toBeGreaterThan(0);
      expect(setting.description.length).toBeGreaterThan(0);
      expect(setting.defaultValue).toBeGreaterThanOrEqual(1);
      expect(setting.defaultValue).toBeLessThanOrEqual(setting.max);
    }
  });

  it("accepts a whole set of whole numbers in range and refuses anything else", () => {
    expect(concurrencySettingsSchema.safeParse(DEFAULTS).success).toBe(true);
    expect(concurrencySettingsSchema.safeParse({ ...DEFAULTS, renderThreads: 16 }).success).toBe(true);
    for (const wrong of [
      { ...DEFAULTS, render: 0 },
      { ...DEFAULTS, archive: 9 },
      { ...DEFAULTS, renderThreads: 17 },
      { ...DEFAULTS, voice: 1.5 },
      { ...DEFAULTS, claude: "2" },
      { ...DEFAULTS, extraction: Number.NaN },
      { ...DEFAULTS, general: 3 },
    ]) {
      expect(concurrencySettingsSchema.safeParse(wrong).success).toBe(false);
    }
    const { notebooklm: _missing, ...incomplete } = DEFAULTS;
    expect(concurrencySettingsSchema.safeParse(incomplete).success).toBe(false);
  });

  it("says in Vietnamese which number is wrong", () => {
    const result = concurrencySettingsSchema.safeParse({ ...DEFAULTS, archive: 9 });
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("Lưu Google Drive: nhiều nhất 8.");
  });
});
