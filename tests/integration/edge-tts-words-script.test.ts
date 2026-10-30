import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EdgeTtsProvider } from "@/server/tts/edge/edge-tts-provider";
import { edgeTtsWordsScript } from "@/server/tts/edge/edge-tts-python";

// Runs the real edge-tts-words.py with a stand-in edge_tts module put first on PYTHONPATH, so the script's own code
// (arguments, streaming, the timings file, the missing-module exit) is tested without the online service.
const hasPython = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const STUB = `__version__ = "9.9.9"

class Communicate:
    def __init__(self, text, voice, rate="+0%", boundary="SentenceBoundary"):
        assert boundary == "WordBoundary"
        self.text = text

    async def stream(self):
        yield {"type": "audio", "data": b"ID3stub-audio"}
        offset = 1_000_000
        for word in self.text.split():
            yield {"type": "WordBoundary", "offset": offset, "duration": 2_000_000, "text": word.strip(",.?")}
            offset += 3_000_000
`;

let dir: string;
let previousPythonPath: string | undefined;

function useModule(source: string) {
  fs.mkdirSync(path.join(dir, "modules", "edge_tts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "modules", "edge_tts", "__init__.py"), source);
  process.env.PYTHONPATH = path.join(dir, "modules");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-edge-words-"));
  previousPythonPath = process.env.PYTHONPATH;
});

afterEach(() => {
  if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
  else process.env.PYTHONPATH = previousPythonPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasPython)("edge-tts-words.py", () => {
  const request = () => ({
    text: "Một trang, rồi một trang nữa.",
    voice: "vi-VN-NamMinhNeural",
    speedPercent: 15,
    outputFile: path.join(dir, "out.mp3"),
  });

  it("writes the audio and the word timings the service streams", async () => {
    useModule(STUB);
    const provider = new EdgeTtsProvider({ python: "python3", script: edgeTtsWordsScript(), retryDelaysMs: [] });

    const { boundaries } = await provider.synthesize(request());

    expect(fs.readFileSync(path.join(dir, "out.mp3"), "utf8")).toBe("ID3stub-audio");
    expect(boundaries?.map((word) => word.text)).toEqual(["Một", "trang", "rồi", "một", "trang", "nữa"]);
    expect(boundaries?.[1]).toEqual({ text: "trang", startMs: 400, endMs: 600 });
  });

  it("prints the edge_tts version for the diagnostics", () => {
    useModule(STUB);
    const output = execFileSync("python3", [edgeTtsWordsScript(), "--version"], { encoding: "utf8" });
    expect(output.trim()).toBe("edge-tts 9.9.9");
  });

  it("exits with the missing-module code when edge_tts cannot be imported", async () => {
    useModule('raise ImportError("not installed")\n');
    const provider = new EdgeTtsProvider({ python: "python3", script: edgeTtsWordsScript(), retryDelaysMs: [] });

    await expect(provider.synthesize(request())).rejects.toMatchObject({ code: "TTS_UNAVAILABLE" });
    expect(fs.existsSync(path.join(dir, "out.mp3"))).toBe(false);
  });
});
