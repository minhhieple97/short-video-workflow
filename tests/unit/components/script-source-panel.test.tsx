import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScriptSourcePanel } from "@/features/productions/components/script-source-panel";
import type { VideoProductionDto } from "@/features/productions/schemas/video-production.dto";

const production: VideoProductionDto = {
  productionId: "production-1",
  status: "COMPLETED",
  checkpoint: "RENDERED",
  inProgress: false,
  correction: null,
  earlierPass: null,
  scenePlanVersion: "scene-plan-v9",
  draft: [
    {
      beat: "LESSON",
      narration: "Bắt đầu nhỏ.",
      illustrative: false,
      sources: [
        { page: 12, text: "Trích đoạn có trang." },
        { page: null, text: "Trích đoạn chưa biết trang." },
      ],
    },
  ],
};

describe("ScriptSourcePanel source locations", () => {
  it("shows known pages and labels unknown pages without presenting a made-up page", () => {
    const html = renderToStaticMarkup(<ScriptSourcePanel production={production} />);

    expect(html).toContain("Trang 12:");
    expect(html).toContain("Chưa xác định trang:");
    expect(html).toContain("Trích đoạn có trang.");
    expect(html).toContain("Trích đoạn chưa biết trang.");
    expect(html).not.toMatch(/Trang (?:1|null):/);
  });
});
