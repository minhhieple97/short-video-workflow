import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { probeMedia } from "@/server/media/ffprobe";
import type { TtsProvider, TtsSynthesisRequest } from "@/server/tts/tts-provider";
import { AppError } from "@/shared/errors";

export interface TtsContractHarness {
  provider: TtsProvider;
  // A provider of the same kind that cannot produce audio.
  failing(): TtsProvider;
}

const SENTENCE = "Vì sao bạn luôn bỏ cuộc sau ba ngày dù đã hứa với chính mình rất nhiều lần như vậy?";

export function describeTtsProviderContract(name: string, createHarness: () => TtsContractHarness): void {
  describe(`TtsProvider contract: ${name}`, () => {
    let dir: string;
    const request = (overrides: Partial<TtsSynthesisRequest> = {}): TtsSynthesisRequest => ({
      text: SENTENCE,
      voice: "vi-VN-NamMinhNeural",
      speedPercent: 0,
      outputFile: path.join(dir, "out.mp3"),
      ...overrides,
    });

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-tts-contract-"));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("identifies itself with an id and a cache version", () => {
      const { provider } = createHarness();

      expect(provider.id.length).toBeGreaterThan(0);
      expect(provider.engineVersion.length).toBeGreaterThan(0);
    });

    it("writes audio that ffprobe can read", async () => {
      const { provider } = createHarness();

      await provider.synthesize(request());

      const probe = await probeMedia(path.join(dir, "out.mp3"));
      expect(probe.audio).not.toBeNull();
      expect(probe.durationMs).toBeGreaterThan(0);
    });

    it("is never slower at a higher speed", async () => {
      const { provider } = createHarness();

      await provider.synthesize(request({ outputFile: path.join(dir, "normal.mp3") }));
      await provider.synthesize(request({ speedPercent: 30, outputFile: path.join(dir, "fast.mp3") }));

      const normal = await probeMedia(path.join(dir, "normal.mp3"));
      const fast = await probeMedia(path.join(dir, "fast.mp3"));
      expect(fast.durationMs).toBeLessThanOrEqual(normal.durationMs + 50);
    });

    it("rejects an already aborted signal before writing anything", async () => {
      const { provider } = createHarness();
      const controller = new AbortController();
      controller.abort();

      await expect(provider.synthesize(request(), { signal: controller.signal })).rejects.toMatchObject({
        code: "JOB_CANCELLED",
      });
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("fails with a TTS_* error and leaves no file behind when it cannot produce audio", async () => {
      const failing = createHarness().failing();

      const error: unknown = await failing.synthesize(request()).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toMatch(/^TTS_/);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
}
