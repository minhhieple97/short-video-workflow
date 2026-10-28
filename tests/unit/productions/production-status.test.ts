import { describe, expect, it } from "vitest";

import {
  deriveBatchStatus,
  hasReachedCheckpoint,
  isTerminalItemStatus,
  ITEM_CHECKPOINTS,
  nextCheckpoint,
  type ItemStatus,
} from "@/features/productions/domain/production-status";

describe("deriveBatchStatus", () => {
  const status = (...items: ItemStatus[]) => deriveBatchStatus(items);

  it.each([
    [[], "QUEUED"],
    [["PENDING", "PENDING"], "QUEUED"],
    [["PENDING", "RUNNING"], "RUNNING"],
    [["COMPLETED", "PENDING"], "RUNNING"],
    [["COMPLETED", "WAITING"], "RUNNING"],
    [["COMPLETED", "COMPLETED"], "COMPLETED"],
    [["COMPLETED", "FAILED"], "PARTIAL"],
    [["COMPLETED", "CANCELLED"], "PARTIAL"],
    [["FAILED", "FAILED"], "FAILED"],
    [["FAILED", "CANCELLED"], "FAILED"],
    [["CANCELLED", "CANCELLED"], "CANCELLED"],
  ] as [ItemStatus[], string][])("derives %j as %s", (items, expected) => {
    expect(status(...items)).toBe(expected);
  });

  it("does not call a batch finished while any item can still progress", () => {
    expect(status("COMPLETED", "FAILED", "WAITING")).toBe("RUNNING");
  });
});

describe("item helpers", () => {
  it("knows which statuses are final", () => {
    expect(["COMPLETED", "FAILED", "CANCELLED"].every((value) => isTerminalItemStatus(value as ItemStatus))).toBe(true);
    expect(["PENDING", "RUNNING", "WAITING"].some((value) => isTerminalItemStatus(value as ItemStatus))).toBe(false);
  });

  it("orders checkpoints along the pipeline", () => {
    expect(ITEM_CHECKPOINTS).toEqual(["NONE", "DRAFTED", "COMPILED", "APPLIED", "VOICED", "READY", "RENDERED"]);
    expect(hasReachedCheckpoint("VOICED", "COMPILED")).toBe(true);
    expect(hasReachedCheckpoint("VOICED", "VOICED")).toBe(true);
    expect(hasReachedCheckpoint("DRAFTED", "VOICED")).toBe(false);
    expect(nextCheckpoint("NONE")).toBe("DRAFTED");
    expect(nextCheckpoint("RENDERED")).toBeNull();
  });
});
