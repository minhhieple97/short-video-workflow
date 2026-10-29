import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Claim from "@/features/productions/repositories/production-claim.repository";
import type * as Correction from "@/features/productions/services/ai-correction.service";
import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as DbClient from "@/server/db/client";

import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

const TOKEN = "worker-a";

let env: TestEnvironment;
let db: typeof DbClient;
let claim: typeof Claim;
let correction: typeof Correction;
let productions: typeof ProductionRequest;

let itemId: string;
let videoId: string;

const item = () => db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } });
const setCheckpoint = (checkpoint: string) =>
  db.prisma.productionItem.update({ where: { id: itemId }, data: { checkpoint } });
const request = (codes: string[], claimToken = TOKEN) =>
  correction.requestAiCorrection({ itemId, claimToken, issues: codes.map((code) => ({ code })) });

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  claim = await import("@/features/productions/repositories/production-claim.repository");
  correction = await import("@/features/productions/services/ai-correction.service");
  productions = await import("@/features/productions/services/production-request.service");
}, 60_000);

beforeEach(async () => {
  ({ itemId, videoId } = await seedProduction({ db, productions }));
  await claim.claimProductionItem(itemId, TOKEN, 60_000);
  await setCheckpoint("VOICED");
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("requestAiCorrection", () => {
  it("sends a length problem to the compiler, records the note and goes back to the draft step", async () => {
    const outcome = await request(["OVER_TARGET"]);

    expect(outcome).toMatchObject({ status: "CORRECTION_STARTED", target: "SCENE_COMPILER", rewoundTo: "DRAFTED" });
    expect(await item()).toMatchObject({
      aiCorrectionTarget: "SCENE_COMPILER",
      checkpoint: "DRAFTED",
      aiCorrectionNote: expect.stringContaining("không nới khoảng"),
    });
  });

  it("sends a content or source problem back to the script studio, from the very start", async () => {
    const outcome = await request(["SOURCE_MISSING"]);

    expect(outcome).toMatchObject({ status: "CORRECTION_STARTED", target: "SCRIPT_STUDIO", rewoundTo: "NONE" });
    expect(await item()).toMatchObject({ aiCorrectionTarget: "SCRIPT_STUDIO", checkpoint: "NONE" });
  });

  it("never touches the preset or the reading pace, however the video overran", async () => {
    await db.prisma.video.update({ where: { id: videoId }, data: { pace: "FAST" } });

    await request(["OVER_TARGET", "OVER_MAX", "HOOK_TOO_LONG"]);

    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).targetDurationSec).toBe(60);
    expect((await db.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).pace).toBe("FAST");
  });

  it("allows only one correction per video: the second request is refused and changes nothing", async () => {
    await request(["OVER_TARGET"]);
    const afterFirst = await item();
    await setCheckpoint("VOICED");

    await expect(request(["SOURCE_MISSING"])).resolves.toEqual({ status: "BUDGET_SPENT" });

    expect(await item()).toMatchObject({
      aiCorrectionTarget: "SCENE_COMPILER",
      aiCorrectionNote: afterFirst.aiCorrectionNote,
      checkpoint: "VOICED",
    });
  });

  it("lets exactly one of several simultaneous requests spend the correction", async () => {
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => request(["OVER_TARGET"])));

    expect(outcomes.filter((outcome) => outcome.status === "CORRECTION_STARTED")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "BUDGET_SPENT")).toHaveLength(4);
  });

  it("leaves the correction unspent when the problem is one an AI cannot fix, so a later fixable one can still use it", async () => {
    await expect(request(["AUDIO_NOT_READY"])).resolves.toEqual({ status: "NOT_CORRECTABLE" });
    expect(await item()).toMatchObject({ aiCorrectionTarget: null, aiCorrectionNote: null, checkpoint: "VOICED" });

    await expect(request(["OVER_TARGET"])).resolves.toMatchObject({ status: "CORRECTION_STARTED" });
  });

  it("refuses a caller that does not hold the item, without spending the correction", async () => {
    await expect(request(["OVER_TARGET"], "intruder")).rejects.toMatchObject({ code: "PRODUCTION_CLAIM_LOST" });

    expect((await item()).aiCorrectionTarget).toBeNull();
  });

  it("rejects a stale holder in the update itself, so losing the lease after the check cannot spend the correction", async () => {
    const { spendAiCorrection } = await import("@/features/productions/repositories/production-step.repository");

    await expect(
      spendAiCorrection({
        itemId,
        claimToken: "stale-holder",
        target: "SCENE_COMPILER",
        note: "n",
        rewindTo: "DRAFTED",
      }),
    ).resolves.toEqual({ status: "LOST_CLAIM" });

    expect(await item()).toMatchObject({ aiCorrectionTarget: null, checkpoint: "VOICED" });
  });

  it("only ever moves the item backwards", async () => {
    await setCheckpoint("NONE");

    await expect(request(["OVER_TARGET"])).rejects.toMatchObject({ code: "PRODUCTION_STEP_OUT_OF_ORDER" });

    expect(await item()).toMatchObject({ aiCorrectionTarget: null, checkpoint: "NONE" });
  });

  it("works when the problem is found right after compiling, leaving the checkpoint where it is", async () => {
    await setCheckpoint("DRAFTED");

    await expect(request(["INVALID_AI_OUTPUT"])).resolves.toMatchObject({
      status: "CORRECTION_STARTED",
      rewoundTo: "DRAFTED",
    });

    expect((await item()).checkpoint).toBe("DRAFTED");
  });
});
