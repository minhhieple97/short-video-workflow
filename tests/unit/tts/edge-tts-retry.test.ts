import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { synthesizeWithEdgeTts } from "@/server/tts/edge-tts";

const FAKE_EDGE_TTS = path.join(import.meta.dirname, "../../helpers/fake-edge-tts.mjs");
let dir: string;

function request(overrides: { signal?: AbortSignal } = {}) {
  return {
    command: FAKE_EDGE_TTS,
    textFile: path.join(dir, "text.txt"),
    voice: "vi-VN-NamMinhNeural",
    rate: "+0%",
    outputFile: path.join(dir, "out.mp3"),
    timeoutMs: 10_000,
    retryDelaysMs: [20, 20, 20],
    ...overrides,
  };
}

const calls = () => Number(fs.readFileSync(path.join(dir, "calls"), "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-tts-"));
  fs.writeFileSync(path.join(dir, "text.txt"), "Vì sao bạn luôn bỏ cuộc sau ba ngày?");
  process.env.FAKE_EDGE_TTS_COUNTER = path.join(dir, "calls");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const key of ["FAKE_EDGE_TTS_COUNTER", "FAKE_EDGE_TTS_MODE", "FAKE_EDGE_TTS_FAILS"]) delete process.env[key];
});

describe("edge-tts adapter", () => {
  it("retries when the service briefly returns no audio, then succeeds", async () => {
    process.env.FAKE_EDGE_TTS_FAILS = "2";
    await synthesizeWithEdgeTts(request());
    expect(calls()).toBe(3);
    expect(fs.statSync(path.join(dir, "out.mp3")).size).toBeGreaterThan(0);
  });

  it("gives up with TTS_FAILED after the last retry and leaves no partial file", async () => {
    process.env.FAKE_EDGE_TTS_FAILS = "99";
    await expect(synthesizeWithEdgeTts(request())).rejects.toMatchObject({
      code: "TTS_FAILED",
      message: expect.stringMatching(/sau 4 lần thử/),
    });
    expect(calls()).toBe(4);
    expect(fs.existsSync(path.join(dir, "out.mp3"))).toBe(false);
  });

  it("does not retry a 403 and explains that edge-tts must be upgraded", async () => {
    process.env.FAKE_EDGE_TTS_MODE = "403";
    await expect(synthesizeWithEdgeTts(request())).rejects.toMatchObject({
      code: "TTS_REJECTED",
      message: expect.stringContaining("pip install -U edge-tts"),
    });
    expect(calls()).toBe(1);
  });

  it("does not retry a permanent error", async () => {
    process.env.FAKE_EDGE_TTS_MODE = "invalid-voice";
    await expect(synthesizeWithEdgeTts(request())).rejects.toMatchObject({
      code: "TTS_FAILED",
      message: expect.stringContaining("Invalid voice"),
    });
    expect(calls()).toBe(1);
  });

  it("stops when the job is cancelled", async () => {
    process.env.FAKE_EDGE_TTS_MODE = "slow";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await expect(synthesizeWithEdgeTts(request({ signal: controller.signal }))).rejects.toMatchObject({
      code: "JOB_CANCELLED",
    });
  });
});
