import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import { AppError, JobCancelledError } from "@/shared/errors";

export interface EdgeTtsRequest {
  command: string;
  textFile: string;
  voice: string;
  rate: string;
  outputFile: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

// edge-tts is an unofficial online service: every failure is reported clearly so the user can upload audio instead.
export async function synthesizeWithEdgeTts(request: EdgeTtsRequest): Promise<void> {
  const stderr = await new Promise<string>((resolve, reject) => {
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
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), request.timeoutMs);
    const onAbort = () => child.kill("SIGTERM");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new AppError(
          "TTS_UNAVAILABLE",
          `Không chạy được "${request.command}". Cài bằng \`pip install -U edge-tts\` hoặc tải âm thanh lên.`,
          503,
          {
            cause: error,
          },
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      if (request.signal?.aborted) reject(new JobCancelledError());
      else if (code === 0) resolve(output);
      else
        reject(
          new AppError(
            "TTS_FAILED",
            `edge-tts lỗi (mã ${code}): ${output.split("\n").filter(Boolean).at(-1) ?? ""}`.slice(0, 400),
            502,
          ),
        );
    });
  });

  const stats = await fs.stat(request.outputFile).catch(() => null);
  if (!stats || stats.size === 0) {
    await fs.rm(request.outputFile, { force: true });
    throw new AppError(
      "TTS_FAILED",
      `edge-tts không tạo được âm thanh${stderr ? ` (${stderr.trim().split("\n").at(-1)})` : ""}. Thử \`pip install -U edge-tts\` hoặc tải âm thanh lên.`,
      502,
    );
  }
}
