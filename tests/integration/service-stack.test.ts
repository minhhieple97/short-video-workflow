import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { startServices, type Service, type StackOptions } from "../../scripts/lib/service-stack";

// Real child processes (plain `node -e` programs) stand in for the web server and the worker.

function collector() {
  const chunks: string[] = [];
  return {
    write: (text: string) => chunks.push(text),
    text: () => chunks.join(""),
    lines: () => chunks.join("").split("\n").filter(Boolean),
  };
}

type Collector = ReturnType<typeof collector>;

function node(name: string, source: string): Service {
  return { name, command: process.execPath, args: ["-e", source] };
}

function options(out: Collector, err: Collector, overrides: Partial<StackOptions> = {}): StackOptions {
  return { primary: "web", stdout: out, stderr: err, color: false, stopTimeoutMs: 2_000, ...overrides };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidIn(text: string): number {
  const match = /pid=(\d+)/.exec(text);
  if (!match?.[1]) throw new Error(`no pid in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error("Timed out waiting for the expected state");
}

const IDLE = "setInterval(() => {}, 1000);";
const PRINT_PID = 'console.log("pid=" + process.pid);';

describe("startServices", () => {
  it("prefixes each line with its service, joins a line split across chunks, and keeps stderr apart", async () => {
    const out = collector();
    const err = collector();
    const stack = startServices(
      [
        node(
          "web",
          `process.stdout.write("hello "); setTimeout(() => { process.stdout.write("world\\nsecond\\n"); console.error("oops"); setTimeout(() => process.exit(0), 100); }, 150);`,
        ),
        node("worker", `console.log("hi"); ${IDLE}`),
      ],
      options(out, err),
    );

    expect(await stack.finished).toBe(0);

    expect(out.lines()).toEqual(expect.arrayContaining(["[web]    hello world", "[web]    second", "[worker] hi"]));
    expect(err.lines()).toContain("[web]    oops");
    expect(out.text()).not.toContain("oops");
  });

  it("rewrites every output line with formatLine before tagging it, on stdout and stderr alike", async () => {
    const out = collector();
    const err = collector();
    const stack = startServices(
      [node("web", `console.log("one"); console.error("two");`)],
      options(out, err, { formatLine: (line) => `<${line.toUpperCase()}>` }),
    );

    await stack.finished;

    expect(out.lines()).toEqual(["[web] <ONE>"]);
    expect(err.lines()).toContain("[web] <TWO>");
  });

  it("colours the tags and asks the services for colour when the terminal can show it", async () => {
    const out = collector();
    const stack = startServices(
      [node("web", 'console.log("force=" + process.env.FORCE_COLOR);')],
      options(out, collector(), { color: true }),
    );

    await stack.finished;

    expect(out.text()).toContain("\u001b[36m[web]\u001b[0m force=1");
  });

  it("stops the other services and returns the exit code of the primary when it ends by itself", async () => {
    const out = collector();
    const err = collector();
    const stack = startServices(
      [node("web", "setTimeout(() => process.exit(3), 600);"), node("worker", `${PRINT_PID} ${IDLE}`)],
      options(out, err),
    );

    expect(await stack.finished).toBe(3);

    expect(isAlive(pidIn(out.text()))).toBe(false);
    expect(err.lines()).toContain("[web]    đã thoát (mã 3); dừng các dịch vụ còn lại.");
  });

  it("reports a secondary service that ends and keeps the rest running", async () => {
    const out = collector();
    const err = collector();
    const stack = startServices(
      [node("web", `console.log("up"); ${IDLE}`), node("worker", "setTimeout(() => process.exit(1), 200);")],
      options(out, err),
    );
    let settled = false;
    void stack.finished.then(() => (settled = true));

    await waitFor(() => err.text().includes("[worker] đã thoát (mã 1); các dịch vụ còn lại vẫn chạy."));
    await sleep(300);
    expect(settled).toBe(false);

    stack.stop();
    expect(await stack.finished).toBe(0);
  });

  it("asks once with SIGTERM and lets the service wind down", async () => {
    const out = collector();
    const stack = startServices(
      [
        node(
          "web",
          `process.on("SIGTERM", () => { console.log("got SIGTERM"); setTimeout(() => process.exit(0), 200); }); console.log("ready"); ${IDLE}`,
        ),
      ],
      options(out, collector()),
    );
    await waitFor(() => out.text().includes("ready"));

    stack.stop();
    stack.stop();

    expect(await stack.finished).toBe(0);
    expect(out.text().match(/got SIGTERM/g)).toHaveLength(1);
  });

  it("kills a service that ignores SIGTERM once the stop timeout has passed", async () => {
    const out = collector();
    const stack = startServices(
      [node("web", `process.on("SIGTERM", () => console.log("ignoring SIGTERM")); ${PRINT_PID} ${IDLE}`)],
      options(out, collector(), { stopTimeoutMs: 400 }),
    );
    await waitFor(() => out.text().includes("pid="));
    const pid = pidIn(out.text());

    stack.stop();

    expect(await stack.finished).toBe(0);
    expect(out.text()).toContain("ignoring SIGTERM");
    expect(isAlive(pid)).toBe(false);
  });

  it("stops what a service left behind when it ends", async () => {
    const out = collector();
    const stack = startServices(
      [
        node(
          "web",
          `const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
           console.log("pid=" + child.pid);
           setTimeout(() => process.exit(0), 300);`,
        ),
      ],
      options(out, collector()),
    );

    expect(await stack.finished).toBe(0);

    expect(isAlive(pidIn(out.text()))).toBe(false);
  });

  it("kills every service at once on request", async () => {
    const out = collector();
    const stack = startServices(
      [node("web", `${PRINT_PID} ${IDLE}`), node("worker", `${PRINT_PID} ${IDLE}`)],
      options(out, collector()),
    );
    await waitFor(() => out.text().match(/pid=/g)?.length === 2);
    const pids = [...out.text().matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));

    stack.kill();
    await stack.finished;

    expect(pids.map(isAlive)).toEqual([false, false]);
  });

  it("says so when a service cannot be started, and ends with a failure when it is the primary", async () => {
    const err = collector();
    const stack = startServices(
      [{ name: "web", command: "/nonexistent/program", args: [] }],
      options(collector(), err),
    );

    expect(await stack.finished).toBe(1);

    expect(err.text()).toContain("[web] không khởi động được:");
  });
});
