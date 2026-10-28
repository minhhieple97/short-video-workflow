import { describe, expect, it } from "vitest";

import { ConfigError, parseAppConfig } from "@/shared/config/env";

const VALID_ENV = {
  DATABASE_URL: "file:./data/studio.db",
  REDIS_URL: "redis://127.0.0.1:6379",
};

describe("parseAppConfig", () => {
  it("applies short-form defaults: 9:16, 1080x1920 final, 720x1280 draft, 60s, concurrency 1", () => {
    const config = parseAppConfig(VALID_ENV);

    expect(config.video.aspectRatio).toBe("9:16");
    expect(config.video.final).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(config.video.draft).toEqual({ width: 720, height: 1280, fps: 30 });
    expect(config.video.defaultDurationSec).toBe(60);
    expect(config.video.maxDurationSec).toBe(90);
    expect(config.concurrency).toEqual({ worker: 1, render: 1 });
    expect(config.ai.mode).toBe("cli-task");
  });

  it("coerces numeric strings read from the environment", () => {
    const config = parseAppConfig({ ...VALID_ENV, DEFAULT_VIDEO_DURATION_SEC: "45", WORKER_CONCURRENCY: "2" });

    expect(config.video.defaultDurationSec).toBe(45);
    expect(config.concurrency.worker).toBe(2);
  });

  it("rejects a final render size that is not 9:16", () => {
    expect(() => parseAppConfig({ ...VALID_ENV, RENDER_WIDTH: "1920", RENDER_HEIGHT: "1080" })).toThrow(ConfigError);
  });

  it("rejects a default duration outside the allowed presets", () => {
    expect(() => parseAppConfig({ ...VALID_ENV, DEFAULT_VIDEO_DURATION_SEC: "70" })).toThrow(ConfigError);
  });

  it("rejects a default duration longer than the maximum", () => {
    expect(() =>
      parseAppConfig({ ...VALID_ENV, DEFAULT_VIDEO_DURATION_SEC: "90", MAX_VIDEO_DURATION_SEC: "60" }),
    ).toThrow(ConfigError);
  });

  it("rejects a maximum duration above 90 seconds", () => {
    expect(() => parseAppConfig({ ...VALID_ENV, MAX_VIDEO_DURATION_SEC: "120" })).toThrow(ConfigError);
  });

  it("reads import limits and extra chapter patterns", () => {
    const config = parseAppConfig({
      ...VALID_ENV,
      MAX_IMPORT_SIZE_MB: "2",
      CHAPTER_HEADING_PATTERNS: '["^bài\\\\s+\\\\d+$"]',
    });
    expect(config.import.maxSizeBytes).toBe(2 * 1024 * 1024);
    expect(config.import.extraChapterPatterns).toEqual(["^bài\\s+\\d+$"]);
    expect(parseAppConfig(VALID_ENV).import).toEqual({ maxSizeBytes: 10 * 1024 * 1024, extraChapterPatterns: [] });
  });

  it("rejects malformed chapter pattern configuration", () => {
    expect(() => parseAppConfig({ ...VALID_ENV, CHAPTER_HEADING_PATTERNS: "not json" })).toThrow(ConfigError);
    expect(() => parseAppConfig({ ...VALID_ENV, CHAPTER_HEADING_PATTERNS: '["(unclosed"]' })).toThrow(ConfigError);
  });

  it("requires a SQLite file URL and a Redis URL", () => {
    expect(() => parseAppConfig({ ...VALID_ENV, DATABASE_URL: "postgres://localhost/db" })).toThrow(ConfigError);
    expect(() => parseAppConfig({ DATABASE_URL: VALID_ENV.DATABASE_URL })).toThrow(ConfigError);
  });

  it("sets the PDF, OCR ceiling and Mistral defaults, and treats an empty API key as unset", () => {
    const config = parseAppConfig({ ...VALID_ENV, MISTRAL_API_KEY: "" });

    expect(config.pdf.maxSizeBytes).toBe(500 * 1024 * 1024);
    expect(config.ocr.costCeilingMicroUsd).toBe(3_000_000);
    expect(config.mistral).toEqual({
      apiKey: undefined,
      baseUrl: "https://api.mistral.ai",
      ocrModel: "mistral-ocr-4-1",
      usdPer1000Pages: 2,
    });
  });

  it("takes the Mistral key and a base URL without a trailing slash from the environment", () => {
    const config = parseAppConfig({
      ...VALID_ENV,
      MISTRAL_API_KEY: "sk-live",
      MISTRAL_API_BASE_URL: "https://proxy.example.com/",
      OCR_COST_CEILING_USD: "1.5",
    });

    expect(config.mistral).toMatchObject({ apiKey: "sk-live", baseUrl: "https://proxy.example.com" });
    expect(config.ocr.costCeilingMicroUsd).toBe(1_500_000);
  });
});
