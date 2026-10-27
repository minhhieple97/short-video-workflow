import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { AppError, JobCancelledError } from "@/shared/errors";

export interface EdgeTtsRequest {
  command: string;
  textFile: string;
  voice: string;
  rate: string;
  outputFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
  retryDelaysMs?: readonly number[];
}

// edge-tts is an unofficial online service. It regularly answers with no audio or drops the connection for a few
// seconds and then recovers (the same sentence fails, then succeeds), so those attempts are retried here with growing
// pauses. A 403 means the installed edge-tts is too old for the service: retrying cannot help, so it is reported.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const TRANSIENT_ERROR =
  /NoAudioReceived|ClientConnectorError|ServerDisconnectedError|ConnectionResetError|TimeoutError|WSServerHandshakeError: 5\d\d/;
const REJECTED_ERROR = /WSServerHandshakeError: 403|\b403, message/;

type Attempt = { ok: true } | { ok: false; code: number | null; stderr: string; transient: boolean };

function runOnce(request: EdgeTtsRequest): Promise<Attempt> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      request.command,
      [
        "--voice",
        request.voice,
        `--rate=${request.rate}`,
        "--file",
        request.textFile,
        "--write-media",
        request.outputFile,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, request.timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      reject(
        new AppError(
          "TTS_UNAVAILABLE",
          `Không chạy được "${request.command}". Cài bằng \`pip install -U edge-tts\` hoặc tải âm thanh lên.`,
          503,
          { cause: error },
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      if (request.signal?.aborted) {
        reject(new JobCancelledError());
        return;
      }
      void fs
        .stat(request.outputFile)
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

const lastLine = (text: string) => text.trim().split("\n").filter(Boolean).at(-1) ?? "";

export async function synthesizeWithEdgeTts(request: EdgeTtsRequest): Promise<void> {
  const delays = request.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    const result = await runOnce(request);
    if (result.ok) return;
    await fs.rm(request.outputFile, { force: true });

    if (REJECTED_ERROR.test(result.stderr)) {
      throw new AppError(
        "TTS_REJECTED",
        "Dịch vụ giọng đọc từ chối yêu cầu (403), thường do edge-tts đã cũ. Chạy `pip install -U edge-tts` rồi thử lại, hoặc tải âm thanh lên.",
        502,
      );
    }
    const delay = delays[attempt];
    if (!result.transient || delay === undefined) {
      throw new AppError(
        "TTS_FAILED",
        result.transient
          ? `edge-tts không trả về âm thanh sau ${attempt + 1} lần thử (dịch vụ đang chập chờn). Thử lại sau ít phút hoặc tải âm thanh lên.`
          : `edge-tts lỗi (mã ${result.code}): ${lastLine(result.stderr)}`.slice(0, 400),
        502,
      );
    }
    try {
      await sleep(delay, undefined, { signal: request.signal });
    } catch {
      throw new JobCancelledError();
    }
  }
}
