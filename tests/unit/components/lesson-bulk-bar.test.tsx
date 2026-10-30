import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LessonBulkBar } from "@/features/lessons/components/lesson-bulk-bar";
import type { LessonSummary } from "@/features/lessons/schemas/lesson.dto";
import type { ProductionSettingsDto } from "@/features/productions/schemas/production-settings.dto";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const settings: ProductionSettingsDto = {
  defaultRange: { minDurationSec: 30, maxDurationSec: 60 },
  defaultPace: "STANDARD",
  ceilingSec: 300,
  unavailable: null,
};

const lesson = (id: string, overrides: Partial<LessonSummary> = {}): LessonSummary => ({
  id,
  bookId: "book-1",
  title: `Bài ${id}`,
  summary: "Tóm tắt",
  status: "DRAFT",
  origin: "AI",
  chapters: [],
  usedInVideoCount: 0,
  hasSourceExcerpt: true,
  createdAt: "2026-10-30T09:00:00.000Z",
  ...overrides,
});

function bar(selected: LessonSummary[], activeProductions: Record<string, string> = {}) {
  return renderToStaticMarkup(
    <LessonBulkBar
      bookId="book-1"
      selected={selected}
      production={settings}
      activeProductions={activeProductions}
      onDone={() => undefined}
    />,
  );
}

// The text and disabled state of each button on the bar, in order.
function buttons(html: string): { label: string; disabled: boolean }[] {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map((match) => ({
    label: (match[2] ?? "").replace(/<[^>]*>/g, "").trim(),
    disabled: /\sdisabled(=|\s|>)/.test(match[1] ?? ""),
  }));
}

describe("LessonBulkBar", () => {
  it("tells what can be done with a selection, and keeps every action off while nothing is ticked", () => {
    const html = bar([]);

    expect(html).toContain("Chọn bài học để duyệt, từ chối hoặc tạo video cùng lúc.");
    expect(buttons(html)).toEqual([
      { label: "Duyệt", disabled: true },
      { label: "Từ chối", disabled: true },
      { label: "Trả về nháp", disabled: true },
      { label: "Tạo video", disabled: true },
    ]);
  });

  it("counts on the button the lessons a click would make into videos, drafts included: choosing is not approving", () => {
    const html = bar([lesson("a"), lesson("b", { status: "APPROVED" })]);

    expect(html).toContain("Đã chọn 2 bài học");
    expect(html).not.toContain("chưa tạo video được");
    expect(buttons(html).at(-1)).toEqual({ label: "Tạo 2 video", disabled: false });
  });

  it("leaves out lessons that cannot be made and says how many of each kind", () => {
    const html = bar(
      [
        lesson("ok"),
        lesson("archived", { status: "ARCHIVED" }),
        lesson("no-source", { hasSourceExcerpt: false }),
        lesson("busy"),
      ],
      { busy: "production-1" },
    );

    expect(html).toContain("Đã chọn 4 bài học");
    expect(html).toContain("1 bài đã lưu trữ · 1 bài chưa có trích đoạn nguồn · 1 bài đang được sản xuất");
    expect(buttons(html).at(-1)).toEqual({ label: "Tạo 1 video", disabled: false });
  });

  it("turns the button off when every ticked lesson is one that cannot be made", () => {
    const html = bar([lesson("archived", { status: "ARCHIVED" })]);

    expect(buttons(html).at(-1)).toEqual({ label: "Tạo video", disabled: true });
    expect(html).toContain("1 bài đã lưu trữ");
  });

  it("keeps the review buttons counting by the lesson status rules, as before", () => {
    const html = bar([lesson("draft"), lesson("approved", { status: "APPROVED" })]);

    expect(buttons(html).slice(0, 3)).toEqual([
      { label: "Duyệt 1 bài", disabled: false },
      { label: "Từ chối 2 bài", disabled: false },
      { label: "Trả về nháp 1 bài", disabled: false },
    ]);
  });
});
