import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { CallOptions } from "@/server/integrations/call-options";
import { IntegrationError } from "@/server/integrations/integration-error";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { JobCancelledError } from "@/shared/errors";

import type { TtsProvider, TtsSynthesisRequest } from "../tts-provider";

export const EDGE_TTS_ENGINE_VERSION = "edge-tts-trimmed-v1";

const DEFAULT_TIMEOUT_MS = 90_000;
// edge-tts is an unofficial online service. It regularly answers with no audio or drops the connection for a few
// seconds and then recovers (the same sentence fails, then succeeds), so those attempts are retried here with growing
// pauses. A 403 means the installed edge-tts is too old for the service: retrying cannot help, so it is reported.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const TRANSIENT_ERROR =
  /NoAudioReceived|ClientConnectorError|ServerDisconnectedError|ConnectionResetError|TimeoutError|WSServerHandshakeError: 5\d\d/;
const REJECTED_ERROR = /WSServerHandshakeError: 403|\b403, message/;

export function formatEdgeTtsRate(speedPercent: number): string {
  return `${speedPercent >= 0 ? "+" : ""}${speedPercent}%`;
}

interface EdgeTtsRun {
  textFile: string;
  voice: string;
  rate: string;
  outputFile: string;
  signal?: AbortSignal;
}

type Attempt = { ok: true } | { ok: false; code: number | null; stderr: string; transient: boolean };

const lastLine = (text: string) => text.trim().split("\n").filter(Boolean).at(-1) ?? "";

export class EdgeTtsProvider implements TtsProvider {
  readonly id = "edge-tts";
  readonly engineVersion = EDGE_TTS_ENGINE_VERSION;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: { command: string; timeoutMs?: number; retryDelaysMs?: readonly number[] }) {
    this.command = options.command;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  async synthesize(request: TtsSynthesisRequest, { signal }: CallOptions = {}): Promise<void> {
    if (signal?.aborted) throw new JobCancelledError();
    // The narration goes through a text file, never through a shell command line.
    const textFile = `${request.outputFile}.txt`;
    await writeFileAtomic(textFile, request.text);
    try {
      await this.runWithRetries({
        textFile,
        voice: request.voice,
        rate: formatEdgeTtsRate(request.speedPercent),
        outputFile: request.outputFile,
        signal,
      });
    } finally {
      await fs.rm(textFile, { force: true });
    }
  }

  private async runWithRetries(run: EdgeTtsRun): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.runOnce(run);
      if (result.ok) return;
      await fs.rm(run.outputFile, { force: true });

      if (REJECTED_ERROR.test(result.stderr)) {
        throw new IntegrationError(
          "TTS_REJECTED",
          "Dịch vụ giọng đọc từ chối yêu cầu (403), thường do edge-tts đã cũ. Chạy `pip install -U edge-tts` rồi thử lại, hoặc tải âm thanh lên.",
          "REJECTED",
        );
      }
      const delay = this.retryDelaysMs[attempt];
      if (!result.transient || delay === undefined) {
        throw new IntegrationError(
          "TTS_FAILED",
          result.transient
            ? `edge-tts không trả về âm thanh sau ${attempt + 1} lần thử (dịch vụ đang chập chờn). Thử lại sau ít phút hoặc tải âm thanh lên.`
            : `edge-tts lỗi (mã ${result.code}): ${lastLine(result.stderr)}`.slice(0, 400),
          result.transient ? "TRANSIENT" : "REJECTED",
        );
      }
      try {
        await sleep(delay, undefined, { signal: run.signal });
      } catch {
        throw new JobCancelledError();
      }
    }
  }

  private runOnce(run: EdgeTtsRun): Promise<Attempt> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.command,
        ["--voice", run.voice, `--rate=${run.rate}`, "--file", run.textFile, "--write-media", run.outputFile],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);
      const onAbort = () => child.kill("SIGTERM");
      run.signal?.addEventListener("abort", onAbort, { once: true });
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", (error) => {
        clearTimeout(timer);
        run.signal?.removeEventListener("abort", onAbort);
        reject(
          new IntegrationError(
            "TTS_UNAVAILABLE",
            `Không chạy được "${this.command}". Cài bằng \`pip install -U edge-tts\` hoặc tải âm thanh lên.`,
            "REJECTED",
            { cause: error },
          ),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        run.signal?.removeEventListener("abort", onAbort);
        if (run.signal?.aborted) {
          reject(new JobCancelledError());
          return;
        }
        void fs
          .stat(run.outputFile)
          .catch(() => null)
          .then((stats) => {
            const hasAudio = stats !== null && stats.size > 0;
            if (code === 0 && hasAudio) resolve({ ok: true });
            else {
              const silent = code === 0 && !hasAudio;
              resolve({ ok: false, code, stderr, transient: timedOut || silent || TRANSIENT_ERROR.test(stderr) });
            }
          });
      });
    });
  }
}
