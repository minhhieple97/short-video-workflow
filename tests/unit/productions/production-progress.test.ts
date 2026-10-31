import { describe, expect, it } from "vitest";

import { PRODUCTION_STEP_LABELS } from "@/features/productions/domain/production-labels";
import {
  contentFromEarlierPass,
  describeProductionStep,
  productionSteps,
  videoContentOf,
} from "@/features/productions/domain/production-progress";
import { ITEM_CHECKPOINTS, type ItemCheckpoint } from "@/features/productions/domain/production-status";

const states = (checkpoint: ItemCheckpoint, status: Parameters<typeof productionSteps>[1]) =>
  productionSteps(checkpoint, status).map((step) => step.state);

describe("productionSteps", () => {
  it("names six steps and has one checkpoint before each of them", () => {
    expect(PRODUCTION_STEP_LABELS).toHaveLength(6);
    expect(ITEM_CHECKPOINTS.slice(0, 6)).toHaveLength(PRODUCTION_STEP_LABELS.length);
    expect(productionSteps("NONE", "PENDING").map((step) => step.label)).toEqual([...PRODUCTION_STEP_LABELS]);
  });

  it("marks finished steps done, the next one current while alive and the rest to do", () => {
    expect(states("APPLIED", "RUNNING")).toEqual(["done", "done", "done", "current", "todo", "todo"]);
    expect(states("DRAFTED", "WAITING")).toEqual(["done", "current", "todo", "todo", "todo", "todo"]);
  });

  it("marks the step an item stopped at instead of leaving it looking busy", () => {
    expect(states("NONE", "FAILED")).toEqual(["stopped", "todo", "todo", "todo", "todo", "todo"]);
    expect(states("VOICED", "CANCELLED")).toEqual(["done", "done", "done", "done", "stopped", "todo"]);
  });

  it("shows every step done once the video is finished", () => {
    expect(states("RENDERED", "COMPLETED")).toEqual(Array(6).fill("done"));
  });
});

describe("describeProductionStep", () => {
  it("says which step the item is at, in words that match its status", () => {
    expect(describeProductionStep("NONE", "FAILED")).toBe("Dừng ở bước 1/6: Viết bản thảo");
    expect(describeProductionStep("COMPILED", "RUNNING")).toBe("Đang làm bước 3/6: Áp dụng kịch bản");
    expect(describeProductionStep("APPLIED", "WAITING")).toBe("Đang chờ ở bước 4/6: Lồng tiếng");
    expect(describeProductionStep("VOICED", "CANCELLED")).toBe("Đã huỷ ở bước 5/6: Kiểm tra tự động");
    expect(describeProductionStep("READY", "PENDING")).toBe("Chờ tới lượt · bước 6/6: Render bản cuối");
    expect(describeProductionStep("RENDERED", "COMPLETED")).toBe("Đã xong cả 6 bước");
  });
});

describe("contentFromEarlierPass", () => {
  const content = { scriptVersion: 14, sceneCount: 12, voicedSceneCount: 12 };

  it("reports the script and voices a video keeps while the item stands before the step that writes them", () => {
    expect(contentFromEarlierPass("NONE", content)).toEqual(content);
    expect(contentFromEarlierPass("DRAFTED", content)).toEqual(content);
    expect(contentFromEarlierPass("COMPILED", content)).toEqual(content);
  });

  it("reports nothing once the item has written its own scenes, or when the video has none", () => {
    expect(contentFromEarlierPass("APPLIED", content)).toBeNull();
    expect(contentFromEarlierPass("VOICED", content)).toBeNull();
    expect(contentFromEarlierPass("NONE", { scriptVersion: 1, sceneCount: 0, voicedSceneCount: 0 })).toBeNull();
  });
});

describe("videoContentOf", () => {
  it("counts the scenes and those that have a voice-over", () => {
    expect(
      videoContentOf({
        scriptVersion: 3,
        scenes: [{ audioAssetId: "a" }, { audioAssetId: null }, { audioAssetId: "b" }],
      }),
    ).toEqual({ scriptVersion: 3, sceneCount: 3, voicedSceneCount: 2 });
  });
});
