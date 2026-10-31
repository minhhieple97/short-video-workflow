import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductionItemList } from "@/features/productions/components/production-item-list";
import type { ProductionItemViewDto } from "@/features/productions/schemas/production-view.dto";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const item: ProductionItemViewDto = {
  id: "item-1",
  position: 1,
  lessonTitle: "Duy trì hiệu suất",
  videoId: "video-1",
  videoTitle: "Duy trì hiệu suất",
  proposedDuration: null,
  status: "FAILED",
  checkpoint: "NONE",
  reason: "Đã dùng hết lượt sửa AI nên dừng ở lỗi này: Câu trả lời của NotebookLM không đúng định dạng JSON yêu cầu.",
  correction: "Đã dùng lượt sửa AI ở bản thảo",
  correctionNote: "Video ngắn hơn mức tối thiểu: kể sâu hơn từ nguồn.",
  earlierPass: { scriptVersion: 14, sceneCount: 12, voicedSceneCount: 12 },
  render: null,
  archive: null,
  canRetry: true,
  canCancel: false,
};

const html = (overrides: Partial<ProductionItemViewDto> = {}) =>
  renderToStaticMarkup(<ProductionItemList productionId="production-1" items={[{ ...item, ...overrides }]} />);

describe("ProductionItemList progress", () => {
  it("names all six steps and the one an item stopped at, so a count never stands alone", () => {
    const markup = html();

    for (const label of [
      "Viết bản thảo",
      "Biên tập cảnh",
      "Áp dụng kịch bản",
      "Lồng tiếng",
      "Kiểm tra tự động",
      "Render bản cuối",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Dừng ở bước 1/6: Viết bản thảo");
    expect(markup).toContain("dừng ở bước này");
    expect(markup).not.toContain("0/6 bước");
  });

  it("explains an item sent back by the AI correction: why, and what the video still holds from before", () => {
    const markup = html();

    expect(markup).toContain("Lý do: Video ngắn hơn mức tối thiểu");
    expect(markup).toContain("Video vẫn giữ kịch bản v14");
    expect(markup).toContain("12 cảnh");
    expect(markup).toContain("12/12 cảnh có giọng đọc từ trước");
    expect(markup).toContain("Câu trả lời của NotebookLM không đúng định dạng JSON yêu cầu.");
  });

  it("adds no earlier-pass note when the video holds nothing from before", () => {
    const markup = html({ earlierPass: null, correction: null, correctionNote: null });

    expect(markup).not.toContain("có giọng đọc từ trước");
    expect(markup).not.toContain("Lý do:");
  });

  it("shows a finished video as all six steps done", () => {
    const markup = html({ status: "COMPLETED", checkpoint: "RENDERED", reason: null, earlierPass: null });

    expect(markup).toContain("Đã xong cả 6 bước");
    expect(markup).not.toContain("dừng ở bước này");
    expect(markup).not.toContain("đang ở bước này");
  });
});
