import path from "node:path";

import { EdgeTtsProvider } from "@/server/tts/edge/edge-tts-provider";

import { describeTtsProviderContract } from "../../helpers/contracts/tts-provider-contract";
import { FakeTtsProvider } from "../../helpers/fakes/fake-tts-provider";

describeTtsProviderContract("FakeTtsProvider", () => ({
  provider: new FakeTtsProvider(),
  failing: () => new FakeTtsProvider({ fail: true }),
}));

const FAKE_EDGE_TTS_AUDIO = path.join(import.meta.dirname, "../../helpers/fake-edge-tts-audio.mjs");

describeTtsProviderContract("FakeTtsProvider without word timings", () => ({
  provider: new FakeTtsProvider({ boundaries: false }),
  failing: () => new FakeTtsProvider({ fail: true }),
}));

// The fake stands in for the Python that runs edge-tts-words.py.
describeTtsProviderContract("EdgeTtsProvider (fake edge-tts Python)", () => ({
  provider: new EdgeTtsProvider({ python: FAKE_EDGE_TTS_AUDIO, script: "edge-tts-words.py", timeoutMs: 20_000 }),
  failing: () => new EdgeTtsProvider({ python: "/nonexistent/python", script: "edge-tts-words.py" }),
}));
