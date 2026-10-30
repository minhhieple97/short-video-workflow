import { describe, expect, it } from "vitest";

import { formatDevLog } from "../../../scripts/lib/dev-log-format";

const line = (entry: Record<string, unknown>) => JSON.stringify(entry);
const clock = (iso: string) => {
  const at = new Date(iso);
  return [at.getHours(), at.getMinutes(), at.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
};

describe("readable dev logs", () => {
  it("turns an app log line into clock, level, scope, message and fields", () => {
    const iso = "2026-10-30T11:18:01.294Z";
    expect(
      formatDevLog(
        line({
          time: iso,
          level: "info",
          scope: "worker",
          message: "Worker started",
          queue: "studio-jobs",
          concurrency: 1,
        }),
      ),
    ).toBe(`${clock(iso)} info  worker  Worker started  queue=studio-jobs concurrency=1`);
  });

  it("marks warnings and errors, quotes values with spaces, and leaves out empty fields", () => {
    const iso = "2026-10-30T11:18:01.000Z";
    expect(
      formatDevLog(
        line({ time: iso, level: "error", scope: "render", message: "Failed", reason: "no audio", gone: null }),
      ),
    ).toBe(`${clock(iso)} ERROR render  Failed  reason="no audio"`);
    expect(formatDevLog(line({ time: iso, level: "warn", scope: "tts", message: "Slow" }))).toBe(
      `${clock(iso)} WARN  tts  Slow`,
    );
  });

  it("cuts a very long set of fields", () => {
    const shown = formatDevLog(
      line({ time: "2026-10-30T11:18:01.000Z", level: "info", scope: "x", message: "m", blob: "a".repeat(500) }),
    );
    expect(shown.length).toBeLessThan(260);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("leaves anything that is not an app log line as it is", () => {
    for (const other of ["✓ Ready in 442ms", "{not json", "[1,2]", '{"no":"message"}', ""]) {
      expect(formatDevLog(other)).toBe(other);
    }
  });
});
