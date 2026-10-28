import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [1536, "1,5 KB"],
    [5 * 1024 * 1024, "5 MB"],
    [10 * 1024 ** 3, "10 GB"],
    [15.5 * 1024 ** 3, "15,5 GB"],
  ])("writes %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
