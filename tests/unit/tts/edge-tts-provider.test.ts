import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EdgeTtsProvider, formatEdgeTtsRate } from "@/server/tts/edge/edge-tts-provider";

const FAKE_EDGE_TTS = path.join(import.meta.dirname, "../../helpers/fake-edge-tts.mjs");
let dir: string;

const provider = () => new EdgeTtsProvider({ command: FAKE_EDGE_TTS, timeoutMs: 10_000, retryDelaysMs: [20, 20, 20] });

function request() {
  return {
    text: "Vì sao bạn luôn bỏ cuộc sau ba ngày?",
    voice: "vi-VN-NamMinhNeural",
    speedPercent: 0,
    outputFile: path.join(dir, "out.mp3"),
  };
}

const calls = () => Number(fs.readFileSync(path.join(dir, "calls"), "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-tts-"));
  process.env.FAKE_EDGE_TTS_COUNTER = path.join(dir, "calls");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const key of ["FAKE_EDGE_TTS_COUNTER", "FAKE_EDGE_TTS_MODE", "FAKE_EDGE_TTS_FAILS"]) delete process.env[key];
});

describe("formatEdgeTtsRate", () => {
  it.each([
    [0, "+0%"],
    [30, "+30%"],
    [-15, "-15%"],
  ])("writes %i as %s", (speed, expected) => {
    expect(formatEdgeTtsRate(speed)).toBe(expected);
  });
});

describe("edge-tts adapter", () => {
  it("identifies itself with a stable cache version", () => {
    expect(provider()).toMatchObject({ id: "edge-tts", engineVersion: "edge-tts-trimmed-v1" });
  });

  it("retries when the service briefly returns no audio, then succeeds", async () => {
    process.env.FAKE_EDGE_TTS_FAILS = "2";
    await provider().synthesize(request());
    expect(calls()).toBe(3);
    expect(fs.statSync(path.join(dir, "out.mp3")).size).toBeGreaterThan(0);
  });

  it("gives up with a transient TTS_FAILED after the last retry and leaves no partial file", async () => {
    process.env.FAKE_EDGE_TTS_FAILS = "99";
    await expect(provider().synthesize(request())).rejects.toMatchObject({
      code: "TTS_FAILED",
      kind: "TRANSIENT",
      message: expect.stringMatching(/sau 4 lần thử/),
    });
    expect(calls()).toBe(4);
    expect(fs.existsSync(path.join(dir, "out.mp3"))).toBe(false);
  });

  it("does not retry a 403 and explains that edge-tts must be upgraded", async () => {
    process.env.FAKE_EDGE_TTS_MODE = "403";
    await expect(provider().synthesize(request())).rejects.toMatchObject({
      code: "TTS_REJECTED",
      kind: "REJECTED",
      message: expect.stringContaining("pip install -U edge-tts"),
    });
    expect(calls()).toBe(1);
  });

  it("does not retry a permanent error", async () => {
    process.env.FAKE_EDGE_TTS_MODE = "invalid-voice";
    await expect(provider().synthesize(request())).rejects.toMatchObject({
      code: "TTS_FAILED",
      kind: "REJECTED",
      message: expect.stringContaining("Invalid voice"),
    });
    expect(calls()).toBe(1);
  });

  it("reports a missing edge-tts command as unavailable", async () => {
    const missing = new EdgeTtsProvider({ command: path.join(dir, "no-such-edge-tts") });
    await expect(missing.synthesize(request())).rejects.toMatchObject({ code: "TTS_UNAVAILABLE", kind: "REJECTED" });
    expect(fs.readdirSync(dir)).not.toContain("out.mp3.txt");
  });

  it("stops when the job is cancelled", async () => {
    process.env.FAKE_EDGE_TTS_MODE = "slow";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await expect(provider().synthesize(request(), { signal: controller.signal })).rejects.toMatchObject({
      code: "JOB_CANCELLED",
    });
  });
});
