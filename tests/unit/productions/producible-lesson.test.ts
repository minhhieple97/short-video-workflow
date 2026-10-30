import { describe, expect, it } from "vitest";

import {
  PRODUCTION_BLOCK_REASONS,
  PRODUCTION_BLOCKS,
  productionBlock,
  summarizeProductionBlocks,
} from "@/features/productions/domain/producible-lesson";

const ready = { status: "DRAFT", hasSourceExcerpt: true, inProduction: false } as const;

describe("productionBlock", () => {
  it("lets a draft or an approved lesson with an excerpt be made into a video: choosing is not approving", () => {
    expect(productionBlock(ready)).toBeNull();
    expect(productionBlock({ ...ready, status: "APPROVED" })).toBeNull();
  });

  it("blocks an archived lesson, one without an excerpt and one already being made", () => {
    expect(productionBlock({ ...ready, status: "ARCHIVED" })).toBe("ARCHIVED");
    expect(productionBlock({ ...ready, hasSourceExcerpt: false })).toBe("NO_SOURCE");
    expect(productionBlock({ ...ready, inProduction: true })).toBe("IN_PRODUCTION");
  });

  it("names the reason the server would give first when several apply", () => {
    expect(productionBlock({ status: "ARCHIVED", hasSourceExcerpt: false, inProduction: true })).toBe("ARCHIVED");
    expect(productionBlock({ ...ready, hasSourceExcerpt: false, inProduction: true })).toBe("NO_SOURCE");
  });

  it("has a sentence for every block", () => {
    for (const block of PRODUCTION_BLOCKS) expect(PRODUCTION_BLOCK_REASONS[block].length).toBeGreaterThan(10);
  });
});

describe("summarizeProductionBlocks", () => {
  it("counts each kind on one line, always in the same order", () => {
    expect(summarizeProductionBlocks(["IN_PRODUCTION", "ARCHIVED", "IN_PRODUCTION", "NO_SOURCE"])).toBe(
      "1 bài đã lưu trữ · 1 bài chưa có trích đoạn nguồn · 2 bài đang được sản xuất",
    );
  });

  it("says nothing when nothing is blocked", () => {
    expect(summarizeProductionBlocks([])).toBe("");
  });
});
