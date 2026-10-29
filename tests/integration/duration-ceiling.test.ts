import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as VideoService from "@/features/videos/services/video.service";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let videos: typeof VideoService;
let productions: typeof ProductionRequest;

beforeAll(async () => {
  env = setupTestEnvironment();
  process.env.MAX_VIDEO_DURATION_SEC = "90";
  videos = await import("@/features/videos/services/video.service");
  productions = await import("@/features/productions/services/production-request.service");
}, 60_000);

afterAll(() => {
  env.cleanup();
});

describe("MAX_VIDEO_DURATION_SEC on this machine", () => {
  it("is where every new range ends by default", () => {
    expect(videos.defaultDurationRange()).toEqual({ minDurationSec: 30, maxDurationSec: 90 });
  });

  it("refuses a longer range for a new video, a batch and a settings change, whatever the forms offered", async () => {
    const tooLong = { minDurationSec: 30, maxDurationSec: 120 } as const;
    const refused = { code: "DURATION_OVER_LIMIT", httpStatus: 400 };

    await expect(
      videos.createVideo({ bookId: "b", title: "Video", description: null, lessonIds: ["l"], ...tooLong }),
    ).rejects.toMatchObject(refused);
    await expect(
      productions.requestProduction({ bookId: "b", lessonIds: ["l"], idempotencyKey: "key-ceiling", ...tooLong }),
    ).rejects.toMatchObject(refused);
    await expect(
      videos.updateVideo("v", { title: "Video", description: null, platformPreviewMode: null, ...tooLong }),
    ).rejects.toMatchObject(refused);

    // At the ceiling the range itself is fine; these fail later, on the missing book and video.
    const atCeiling = { minDurationSec: 30, maxDurationSec: 90 } as const;
    await expect(
      videos.createVideo({ bookId: "b", title: "Video", description: null, lessonIds: ["l"], ...atCeiling }),
    ).rejects.not.toMatchObject(refused);
    await expect(
      videos.updateVideo("v", { title: "Video", description: null, platformPreviewMode: null, ...atCeiling }),
    ).rejects.toMatchObject({ code: "VIDEO_NOT_FOUND" });
  });
});
