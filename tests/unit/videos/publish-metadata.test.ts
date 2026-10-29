import { describe, expect, it } from "vitest";

import type { LessonSnapshot } from "@/features/videos/domain/lesson-snapshot";
import {
  acceptPublishMetadata,
  captionWithHashtags,
  formatPublishText,
  normalizeHashtag,
  parseHashtagInput,
  publishClaimSources,
  publishMetadataSchema,
  PUBLISH_TITLE_MAX,
} from "@/features/videos/domain/publish-metadata";
import { findUnsupportedClaimsIn } from "@/features/videos/domain/source-claims";
import { scriptTextHash } from "@/features/videos/services/scene-records";

const lesson: LessonSnapshot = {
  lessonId: "lesson-1",
  title: "Bắt đầu từ việc nhỏ",
  summary: "Thói quen lớn bắt đầu bằng một hành động nhỏ mỗi ngày.",
  principle: "Làm nhỏ để làm đều.",
  realLifeScenario: "Một người chạy bộ năm phút mỗi sáng.",
  commonMistake: "Đặt mục tiêu quá lớn ngay từ đầu.",
  betterApproach: "Chọn một việc đủ nhỏ để không thể từ chối.",
  actionableStep: "Viết ra một việc nhỏ cho ngày mai.",
  contentHash: null,
  sources: [{ chapterId: "chapter-1", chapterTitle: "Chương 1", excerpt: "Hãy bắt đầu thật nhỏ." }],
  capturedAt: "2026-10-29T00:00:00.000Z",
};

const sources = publishClaimSources({
  book: { title: "7 thói quen hiệu quả", author: "Stephen Covey" },
  lessons: [lesson],
  scenes: [{ title: null, narration: "Bạn chỉ cần hai phút.", onScreenText: "Hai phút mỗi ngày" }],
});

const draft = {
  title: "Bắt đầu từ việc nhỏ: bí quyết của 7 thói quen",
  caption:
    "Thói quen lớn bắt đầu từ một việc nhỏ.\nSách: 7 thói quen hiệu quả – Stephen Covey\nLưu lại để thử ngày mai!",
  hashtags: ["#SáchHay", "bài học cuộc sống", "#sachhay", "#ĐọcSách", "#7thoiquen"],
};

describe("hashtags", () => {
  it("drops the #, diacritics, spaces and case so one tag has one spelling", () => {
    expect(normalizeHashtag("#SáchHay")).toBe("sachhay");
    expect(normalizeHashtag("bài học cuộc sống")).toBe("baihoccuocsong");
    expect(normalizeHashtag("#ĐọcSách")).toBe("docsach");
    expect(normalizeHashtag("#thói_quen!")).toBe("thoi_quen");
    expect(normalizeHashtag("##")).toBe("");
  });

  it("parses free text into unique tags in order", () => {
    expect(parseHashtagInput("#sachhay #SáchHay, booktok;  #reviewsach #")).toEqual([
      "sachhay",
      "booktok",
      "reviewsach",
    ]);
  });
});

describe("publishMetadataSchema", () => {
  it("normalizes and dedupes the tags", () => {
    const parsed = publishMetadataSchema.parse(draft);
    expect(parsed.hashtags).toEqual(["sachhay", "baihoccuocsong", "docsach", "7thoiquen"]);
  });

  it("enforces the platform limits", () => {
    expect(publishMetadataSchema.safeParse({ ...draft, title: "a".repeat(PUBLISH_TITLE_MAX + 1) }).success).toBe(false);
    expect(publishMetadataSchema.safeParse({ ...draft, title: "Một\nhai" }).success).toBe(false);
    expect(publishMetadataSchema.safeParse({ ...draft, hashtags: ["sachhay", "#SachHay"] }).success).toBe(false);
    expect(
      publishMetadataSchema.safeParse({ ...draft, hashtags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }).success,
    ).toBe(false);
  });

  it("keeps hashtags out of the title and caption", () => {
    const result = publishMetadataSchema.safeParse({ ...draft, caption: "Hay lắm #sachhay" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Caption không chứa hashtag; hashtag nằm ở ô riêng.");
  });
});

describe("acceptPublishMetadata", () => {
  it("accepts numbers that the book, lesson or script contain", () => {
    const result = acceptPublishMetadata(draft, sources);
    expect(result.issue).toBeNull();
    expect(result.metadata?.hashtags).toContain("7thoiquen");
  });

  it("rejects a number or a quotation found in no source", () => {
    const result = acceptPublishMetadata(
      { ...draft, caption: "90% người thất bại vì bỏ qua điều này. Tác giả nói “kỷ luật là tự do”." },
      sources,
    );
    expect(result.issue).toMatchObject({
      code: "PUBLISH_METADATA_UNSUPPORTED_CLAIM",
      claims: { numbers: ["90"], quotes: ["kỷ luật là tự do"] },
    });
    expect(result.metadata).toBeNull();
  });

  it("reports a broken rule instead of throwing", () => {
    const result = acceptPublishMetadata({ ...draft, hashtags: [] }, sources);
    expect(result.issue?.code).toBe("PUBLISH_METADATA_INVALID");
  });
});

describe("findUnsupportedClaimsIn", () => {
  it("reads 1,5 and 1.5 as the same number and ignores case and spacing in quotes", () => {
    expect(
      findUnsupportedClaimsIn(["Chỉ 1,5 phút: “BẮT ĐẦU   thật nhỏ”"], ["1.5 phút", "Hãy bắt đầu thật nhỏ."]),
    ).toEqual({ numbers: [], quotes: [] });
  });
});

describe("formatting", () => {
  it("puts the tags after the caption, ready to paste", () => {
    const metadata = publishMetadataSchema.parse(draft);
    expect(captionWithHashtags(metadata).endsWith("\n\n#sachhay #baihoccuocsong #docsach #7thoiquen")).toBe(true);
    expect(formatPublishText(metadata)).toBe(
      `TIÊU ĐỀ\n${metadata.title}\n\nCAPTION\n${captionWithHashtags(metadata)}\n`,
    );
  });
});

describe("scriptTextHash", () => {
  const hook = { type: "HOOK", title: "Hook", narration: "Một", onScreenText: "Một", hidden: false };
  const principle = { type: "PRINCIPLE", title: null, narration: "Hai", onScreenText: "Hai", hidden: false };
  const scenes = [hook, principle];

  it("ignores everything but the visible words", () => {
    const withAudio = scenes.map((scene) => ({ ...scene, durationFrames: 99, audioAssetId: "asset" }));
    expect(scriptTextHash(withAudio)).toBe(scriptTextHash(scenes));
  });

  it("changes when a scene is hidden, edited or moved", () => {
    const base = scriptTextHash(scenes);
    expect(scriptTextHash([hook, { ...principle, hidden: true }])).not.toBe(base);
    expect(scriptTextHash([hook, { ...principle, narration: "Ba" }])).not.toBe(base);
    expect(scriptTextHash([principle, hook])).not.toBe(base);
  });
});
