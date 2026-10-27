import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { sanitizeClaudeEnv } from "./claude-output";

const execFileAsync = promisify(execFile);

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export async function checkClaudeAuth(command: string): Promise<{ loggedIn: boolean; method: string }> {
  const { stdout } = await execFileAsync(command, ["auth", "status", "--json"], {
    env: sanitizeClaudeEnv(process.env),
    timeout: 30_000,
  });
  const status = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown };
  return {
    loggedIn: status.loggedIn === true,
    method: typeof status.authMethod === "string" ? status.authMethod : "unknown",
  };
}

// Print mode, JSON envelope, no tools at all (the task only needs JSON), prompt on stdin, schema-validated output.
export function runClaudePrint(options: {
  command: string;
  prompt: string;
  jsonSchema: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ClaudeRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      options.command,
      ["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--json-schema", options.jsonSchema],
      { env: sanitizeClaudeEnv(process.env), stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    const abort = () => child.kill("SIGTERM");
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
    child.stdin.end(options.prompt);
  });
}
