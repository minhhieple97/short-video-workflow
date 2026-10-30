import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [0, "0 B"],
    [1024, "1 KiB"],
    [1536, "1,5 KiB"],
    [5 * 1024 * 1024, "5 MiB"],
    [10 * 1024 ** 3, "10 GiB"],
    [15.5 * 1024 ** 3, "15,5 GiB"],
    [32985348833280, "30 TiB"],
    [455028138, "433,9 MiB"],
  ])("writes %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
