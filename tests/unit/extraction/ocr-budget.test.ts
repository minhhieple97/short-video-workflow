import { describe, expect, it } from "vitest";

import { fitsBudget, formatUsd, remainingBudget, toMicroUsd } from "@/features/extraction/domain/ocr-budget";

describe("toMicroUsd", () => {
  it.each([
    [0, 0],
    [0.0005, 500],
    [0.1, 100_000],
    [3, 3_000_000],
    [0.0000005, 1],
    [1.2345678, 1_234_568],
  ])("rounds %s USD up to %i micro-USD without float noise", (usd, micro) => {
    expect(toMicroUsd(usd)).toBe(micro);
  });
});

describe("budget arithmetic", () => {
  const state = { ceilingMicroUsd: 3_000_000, reservedMicroUsd: 1_000_000, spentMicroUsd: 500_000 };

  it("subtracts both reservations and spend from the ceiling", () => {
    expect(remainingBudget(state)).toBe(1_500_000);
  });

  it("never reports a negative remainder when spend overshot the ceiling", () => {
    expect(remainingBudget({ ...state, spentMicroUsd: 9_000_000 })).toBe(0);
  });

  it("fits a request up to and including the remainder", () => {
    expect(fitsBudget(state, 1_500_000)).toBe(true);
    expect(fitsBudget(state, 1_500_001)).toBe(false);
  });

  it("formats dollars with two decimals", () => {
    expect(formatUsd(1_500_000)).toBe("$1.50");
  });
});
