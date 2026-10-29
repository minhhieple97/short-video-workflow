import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError } from "@/server/integrations/integration-error";
import type { TtsProvider, TtsSynthesisRequest } from "@/server/tts/tts-provider";
import { JobCancelledError } from "@/shared/errors";

const execFileAsync = promisify(execFile);

// Seconds a text takes to read at 4 syllables a second, shorter by the speed-up and never under a second.
export function fakeSpeechSeconds(text: string, speedPercent: number): number {
  const syllables = text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  return Math.max(1, Math.round((syllables / (4 * (1 + speedPercent / 100))) * 10) / 10);
}

// Writes a real audio file (a sine tone as long as the speech would be), so the trim/probe/store path runs on it.
export class FakeTtsProvider implements TtsProvider {
  readonly id = "fake-tts";
  readonly engineVersion = "fake-tts-v1";
  readonly requests: TtsSynthesisRequest[] = [];

  constructor(private readonly options: { fail?: boolean } = {}) {}

  async synthesize(request: TtsSynthesisRequest, { signal }: CallOptions = {}): Promise<void> {
    if (signal?.aborted) throw new JobCancelledError();
    this.requests.push(request);
    if (this.options.fail) throw new IntegrationError("TTS_FAILED", "Fake TTS provider failed.", "TRANSIENT");
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${fakeSpeechSeconds(request.text, request.speedPercent)}`,
      "-ar",
      "24000",
      "-ac",
      "1",
      request.outputFile,
    ]);
  }
}
