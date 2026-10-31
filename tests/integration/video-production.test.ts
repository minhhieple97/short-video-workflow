import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as ProductionRequest from "@/features/productions/services/production-request.service";
import type * as VideoProduction from "@/features/productions/services/video-production.service";
import { createDraftArtifact, createScenePlanArtifact } from "@/server/scene-plan/handoff";
import type * as DbClient from "@/server/db/client";
import type { ScriptDraft } from "@/server/script-studio/script-studio-contracts";

import { seedProduction } from "../helpers/production-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let productions: typeof ProductionRequest;
let service: typeof VideoProduction;
let itemId: string;
let videoId: string;

const DRAFT: ScriptDraft = {
  lessonId: "l1",
  targetDurationSec: 60,
  durationReason: "Đủ kể trọn bài học.",
  beats: [
    { beat: "HOOK", narration: "Vì sao bạn cứ hẹn ngày mai?", sourceExcerpts: [], illustrative: false },
    { beat: "SITUATION", narration: "Tối nào bạn cũng định tập.", sourceExcerpts: [], illustrative: true },
    { beat: "MISTAKE", narration: "Bạn đặt mục tiêu quá lớn.", sourceExcerpts: [], illustrative: false },
    {
      beat: "LESSON",
      narration: "Bắt đầu bằng hai phút.",
      sourceExcerpts: [{ page: 12, text: "Hãy bắt đầu nhỏ." }],
      illustrative: false,
    },
    { beat: "RESOLUTION", narration: "Chỉ mang giày vào.", sourceExcerpts: [], illustrative: false },
    { beat: "ACTION", narration: "Tối nay thử ngay.", sourceExcerpts: [], illustrative: false },
  ],
};

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  productions = await import("@/features/productions/services/production-request.service");
  service = await import("@/features/productions/services/video-production.service");
}, 60_000);

beforeEach(async () => {
  ({ itemId, videoId } = await seedProduction({ db, productions }));
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("getVideoProduction", () => {
  it("knows nothing about a video made by hand", async () => {
    const manual = await db.prisma.video.create({
      data: {
        bookId: (await db.prisma.book.findFirstOrThrow()).id,
        title: "Tay",
        targetDurationSec: 60,
        status: "DRAFT",
      },
    });

    expect(await service.getVideoProduction(manual.id)).toBeNull();
  });

  it("marks a video whose production is still running as in progress, without a draft yet", async () => {
    const production = await service.getVideoProduction(videoId);

    expect(production).toMatchObject({
      status: "PENDING",
      checkpoint: "NONE",
      inProgress: true,
      draft: null,
      scenePlanVersion: null,
    });
  });

  it("shows the draft beat by beat with its book excerpts and illustrative scenarios, and the plan version", async () => {
    const draftArtifact = createDraftArtifact({ draft: DRAFT, lessonContentHash: "hash", targetDurationSec: 60 });
    const planArtifact = createScenePlanArtifact({
      plan: {
        hook: { variant: "QUESTION", narration: "Vì sao?", onScreenText: "Vì sao?", visualVariant: "HOOK_QUESTION" },
        scenes: (["SITUATION", "COMMON_MISTAKE", "KEY_TAKEAWAY", "BETTER_APPROACH", "ACTION_STEP"] as const).map(
          (type) => ({
            type,
            narration: "x",
            onScreenText: "x",
            visualVariant: "SCENARIO_CARD" as const,
          }),
        ),
      },
      draftFingerprint: draftArtifact.fingerprint,
      promptVersion: "scene-plan-v1",
      targetDurationSec: 60,
    });
    await db.prisma.productionItem.update({
      where: { id: itemId },
      data: {
        status: "COMPLETED",
        checkpoint: "RENDERED",
        aiCorrectionTarget: "SCRIPT_STUDIO",
        draftArtifactJson: draftArtifact,
        scenePlanArtifactJson: planArtifact,
      },
    });

    const production = await service.getVideoProduction(videoId);

    expect(production).toMatchObject({
      inProgress: false,
      scenePlanVersion: "scene-plan-v1",
      correction: "Đã dùng lượt sửa AI ở bản thảo",
    });
    expect(production?.draft?.map((beat) => [beat.beat, beat.illustrative, beat.sources])).toEqual([
      ["HOOK", false, []],
      ["SITUATION", true, []],
      ["MISTAKE", false, []],
      ["LESSON", false, [{ page: 12, text: "Hãy bắt đầu nhỏ." }]],
      ["RESOLUTION", false, []],
      ["ACTION", false, []],
    ]);
  });

  it("does not show an artifact that no longer matches its fingerprint", async () => {
    const draftArtifact = createDraftArtifact({ draft: DRAFT, lessonContentHash: "hash", targetDurationSec: 60 });
    const tampered = {
      ...draftArtifact,
      draft: { ...draftArtifact.draft, beats: draftArtifact.draft.beats.slice().reverse() },
    };
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { draftArtifactJson: tampered } });

    expect((await service.getVideoProduction(videoId))?.draft).toBeNull();
  });

  it("preserves unknown draft pages through the stored artifact and source DTO", async () => {
    const draft: ScriptDraft = {
      ...DRAFT,
      beats: DRAFT.beats.map((beat) => ({
        ...beat,
        sourceExcerpts: beat.sourceExcerpts.map((excerpt) => ({ ...excerpt, page: null })),
      })),
    };
    const artifact = createDraftArtifact({ draft, lessonContentHash: "hash", targetDurationSec: 60 });
    await db.prisma.productionItem.update({ where: { id: itemId }, data: { draftArtifactJson: artifact } });

    const production = await service.getVideoProduction(videoId);

    expect(production?.draft?.find((beat) => beat.beat === "LESSON")?.sources).toEqual([
      { page: null, text: "Hãy bắt đầu nhỏ." },
    ]);
    expect((await db.prisma.productionItem.findUniqueOrThrow({ where: { id: itemId } })).draftArtifactJson).toEqual(
      artifact,
    );
  });
});
