import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";

export interface Service {
  name: string;
  command: string;
  args: readonly string[];
}

interface OutputSink {
  write(text: string): unknown;
}

export interface StackOptions {
  // The service the session is for: when it ends on its own the others are stopped and its exit code is the result.
  // Any other service ending is reported and the rest keep running.
  primary: string;
  stdout: OutputSink;
  stderr: OutputSink;
  color: boolean;
  // How long a stopping service gets before it and whatever it left behind are killed.
  stopTimeoutMs: number;
}

export interface ServiceStack {
  // Asks every service to stop with SIGTERM.
  stop(): void;
  // Kills every service and its leftovers at once. Synchronous, so it can run from an `exit` handler.
  kill(): void;
  // Settles once every service and its leftovers are gone: the primary's exit code when it ended by itself, otherwise 0.
  finished: Promise<number>;
}

interface Member {
  service: Service;
  child: ChildProcess;
  exited: boolean;
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const TAG_COLORS = ["\u001b[36m", "\u001b[35m", "\u001b[33m"];
const COLOR_RESET = "\u001b[0m";
const GROUP_POLL_MS = 100;
const AFTER_KILL_WAIT_MS = 2_000;

function sendSignal(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

// Each service leads its own process group (`detached`), so a negative pid reaches whatever it spawned too.
function signalGroup(member: Member, signal: NodeJS.Signals | 0): boolean {
  return member.child.pid === undefined ? false : sendSignal(-member.child.pid, signal);
}

function pipeLines(stream: Readable | null, emit: (line: string) => void): void {
  if (stream === null) return;
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (chunk: string) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) emit(line.replace(/\r$/, ""));
  });
  stream.on("end", () => {
    if (pending !== "") emit(pending);
  });
}

function describeExit({ code, signal }: Exit): string {
  return signal === null ? `mã ${code ?? "?"}` : `tín hiệu ${signal}`;
}

export function startServices(services: readonly Service[], options: StackOptions): ServiceStack {
  const nameWidth = Math.max(...services.map((service) => service.name.length));
  const colorFor = (index: number): string => (options.color ? (TAG_COLORS[index % TAG_COLORS.length] ?? "") : "");
  const tagFor = (service: Service, index: number): string => {
    const tag = `[${service.name}]`.padEnd(nameWidth + 2);
    return options.color ? `${colorFor(index)}${tag}${COLOR_RESET}` : tag;
  };

  let stopRequested = false;
  let primaryExitCode: number | null = null;

  const members: Member[] = services.map((service, index) => {
    const tag = tagFor(service, index);
    const child = spawn(service.command, [...service.args], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.color ? { ...process.env, FORCE_COLOR: "1" } : process.env,
    });
    pipeLines(child.stdout, (line) => options.stdout.write(`${tag} ${line}\n`));
    pipeLines(child.stderr, (line) => options.stderr.write(`${tag} ${line}\n`));
    return { service, child, exited: false };
  });

  const kill = (): void => {
    for (const member of members) signalGroup(member, "SIGKILL");
  };

  // A service that ignores SIGTERM must not hold the session open for ever.
  let killTimer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    if (stopRequested) return;
    stopRequested = true;
    killTimer = setTimeout(kill, options.stopTimeoutMs);
    killTimer.unref();
    for (const member of members) {
      if (!member.exited && member.child.pid !== undefined) sendSignal(member.child.pid, "SIGTERM");
    }
  };

  // Once the service itself is gone, anything of its own still alive (a dev server's worker process, say) is stopped too.
  const reapLeftovers = async (member: Member): Promise<void> => {
    if (!signalGroup(member, 0)) return;
    signalGroup(member, "SIGTERM");
    const deadline = Date.now() + options.stopTimeoutMs;
    while (Date.now() < deadline && signalGroup(member, 0)) await sleep(GROUP_POLL_MS);
    if (!signalGroup(member, "SIGKILL")) return;
    const killedBy = Date.now() + AFTER_KILL_WAIT_MS;
    while (Date.now() < killedBy && signalGroup(member, 0)) await sleep(GROUP_POLL_MS);
  };

  const settled = members.map(async (member, index) => {
    const exit = await new Promise<Exit>((resolve) => {
      member.child.once("error", (error) => {
        options.stderr.write(`${tagFor(member.service, index)} không khởi động được: ${error.message}\n`);
        resolve({ code: 1, signal: null });
      });
      member.child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    member.exited = true;

    if (!stopRequested) {
      const isPrimary = member.service.name === options.primary;
      const consequence = isPrimary ? "dừng các dịch vụ còn lại" : "các dịch vụ còn lại vẫn chạy";
      options.stderr.write(`${tagFor(member.service, index)} đã thoát (${describeExit(exit)}); ${consequence}.\n`);
      if (isPrimary) {
        primaryExitCode = exit.code ?? 1;
        stop();
      }
    }
    await reapLeftovers(member);
  });

  const finished = Promise.all(settled).then(() => {
    clearTimeout(killTimer);
    return primaryExitCode ?? 0;
  });

  return { stop, kill, finished };
}
