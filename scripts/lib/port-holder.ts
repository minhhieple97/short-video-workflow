import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import type { PortHolder } from "./dev-banner";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 3_000;
const MAX_COMMAND_CHARS = 110;

// The process `ss -ltnp` names as the owner of a listening socket: users:(("node",pid=535507,fd=42)).
export function parseSsOwner(output: string): { pid: number } | null {
  const match = /pid=(\d+)/.exec(output);
  return match ? { pid: Number(match[1]) } : null;
}

async function readProc(pid: number, file: string): Promise<string | null> {
  try {
    return await fs.readFile(`/proc/${pid}/${file}`, "utf8");
  } catch {
    return null;
  }
}

// Who listens on a port, for the message that explains why the web was not started. Linux (WSL) only: anywhere `ss` or
// /proc is missing the answer is simply "unknown".
export async function findPortHolder(port: number): Promise<PortHolder | null> {
  try {
    const { stdout } = await execFileAsync("ss", ["-H", "-ltnp", `sport = :${port}`], { timeout: PROBE_TIMEOUT_MS });
    const owner = parseSsOwner(stdout);
    if (!owner) return null;
    const cmdline = (await readProc(owner.pid, "cmdline"))?.split("\0").filter(Boolean).join(" ") ?? "";
    const cwd = await fs.readlink(`/proc/${owner.pid}/cwd`).catch(() => null);
    const command = cmdline.length > MAX_COMMAND_CHARS ? `${cmdline.slice(0, MAX_COMMAND_CHARS)}…` : cmdline;
    return { pid: owner.pid, command: command || "không đọc được lệnh", cwd };
  } catch {
    return null;
  }
}

// This project's web answers /api/status with the worker state, the active job count and the AI mode.
export async function isProjectWeb(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "worker" in body && "activeJobs" in body && "aiMode" in body;
  } catch {
    return false;
  }
}
