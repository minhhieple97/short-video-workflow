import { describe, expect, it } from "vitest";

import { deferred, isDeferred, isWaitingForCli } from "@/worker/processors/types";

describe("deferred processor result", () => {
  it("carries a whole-millisecond delay and is recognised by the dispatcher", () => {
    const result = deferred(1_500.2);

    expect(result).toEqual({ deferred: true, retryAfterMs: 1_501 });
    expect(isDeferred(result)).toBe(true);
    expect(isWaitingForCli(result)).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s as a delay", (delay) => {
    expect(() => deferred(delay)).toThrow(RangeError);
  });

  it.each([null, undefined, "deferred", { deferred: false }, { waitingForCli: true, taskDir: "x" }])(
    "does not mistake %j for a deferral",
    (value) => {
      expect(isDeferred(value)).toBe(false);
    },
  );
});
