import path from "node:path";

import { EdgeTtsProvider } from "@/server/tts/edge/edge-tts-provider";

import { describeTtsProviderContract } from "../../helpers/contracts/tts-provider-contract";
import { FakeTtsProvider } from "../../helpers/fakes/fake-tts-provider";

describeTtsProviderContract("FakeTtsProvider", () => ({
  provider: new FakeTtsProvider(),
  failing: () => new FakeTtsProvider({ fail: true }),
}));

const FAKE_EDGE_TTS_AUDIO = path.join(import.meta.dirname, "../../helpers/fake-edge-tts-audio.mjs");

describeTtsProviderContract("EdgeTtsProvider (fake edge-tts command)", () => ({
  provider: new EdgeTtsProvider({ command: FAKE_EDGE_TTS_AUDIO, timeoutMs: 20_000 }),
  failing: () => new EdgeTtsProvider({ command: "/nonexistent/edge-tts" }),
}));
