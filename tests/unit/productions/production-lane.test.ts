import { describe, expect, it } from "vitest";

import { productionLaneFor } from "@/features/productions/domain/production-lane";
import { ITEM_CHECKPOINTS } from "@/features/productions/domain/production-status";

describe("productionLaneFor", () => {
  it("sends Opus drafts to the Claude lane without changing legacy drafts", () => {
    expect(productionLaneFor("NONE", true)).toBe("claude");
    expect(productionLaneFor("NONE", false)).toBe("notebooklm");
  });
  it("runs each step in the lane of the resource it holds", () => {
    expect(productionLaneFor("NONE")).toBe("notebooklm");
    expect(productionLaneFor("DRAFTED")).toBe("claude");
    expect(productionLaneFor("APPLIED")).toBe("voice");
  });

  it("keeps the steps that only touch the database, and the wait for the render, in the general lane", () => {
    for (const checkpoint of ["COMPILED", "VOICED", "READY", "RENDERED"] as const) {
      expect(productionLaneFor(checkpoint)).toBe("general");
    }
  });

  it("names a lane for every checkpoint", () => {
    for (const checkpoint of ITEM_CHECKPOINTS) expect(productionLaneFor(checkpoint).length).toBeGreaterThan(0);
  });
});
