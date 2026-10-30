import { describe, expect, it } from "vitest";

import {
  analyzeAction,
  countAnalysisProgress,
  isAnalysisRunning,
  type BookAnalysisOverview,
} from "@/features/chapters/domain/analysis-progress";
import { isAnalysisInProgress, selectionBlockedNote } from "@/features/chapters/domain/analysis-status";
import { extractionProgressState } from "@/features/extraction/domain/extraction-status";

const overview = (overrides: Partial<BookAnalysisOverview> = {}): BookAnalysisOverview => ({
  ...countAnalysisProgress(["NOT_ANALYZED", "NOT_ANALYZED", "NOT_ANALYZED"]),
  needsAnalysis: 3,
  needsAnalysisIds: ["c1", "c2", "c3"],
  outdated: 0,
  currentChapter: null,
  ...overrides,
});

describe("countAnalysisProgress", () => {
  it("counts every chapter once, by its analysis state", () => {
    const progress = countAnalysisProgress([
      "ANALYZED",
      "ANALYZED",
      "PARTIAL",
      "FAILED",
      "QUEUED",
      "ANALYZING",
      "WAITING_FOR_CLI",
      "NOT_ANALYZED",
    ]);

    expect(progress).toEqual({
      total: 8,
      analyzed: 2,
      partial: 1,
      failed: 1,
      queued: 1,
      analyzing: 1,
      waitingForCli: 1,
      notAnalyzed: 1,
    });
    expect(isAnalysisRunning(progress)).toBe(true);
    // Queued but not picked up yet still counts: the worker has the book in hand.
    expect(isAnalysisRunning(countAnalysisProgress(["QUEUED", "ANALYZED"]))).toBe(true);
    expect(isAnalysisRunning(countAnalysisProgress(["WAITING_FOR_CLI", "ANALYZED"]))).toBe(false);
  });
});

describe("analyzeAction", () => {
  it("offers to analyse every chapter of a fresh book", () => {
    expect(analyzeAction(overview(), null)).toEqual({
      enabled: true,
      busy: false,
      label: "Phân tích tất cả chương",
      note: null,
    });
  });

  it("is off without chapters, and says whether the PDF is still on its way or has stopped", () => {
    const none = overview({ ...countAnalysisProgress([]), needsAnalysis: 0 });

    expect(analyzeAction(none, "running")).toMatchObject({ enabled: false, busy: false });
    expect(analyzeAction(none, "running").note).toContain("Đang trích xuất PDF");
    expect(analyzeAction(none, "stopped").note).toContain("Trích xuất PDF đang dừng");
    expect(analyzeAction(none, null).note).toContain("Sách chưa có chương để phân tích");
  });

  it("stays busy and off while chapters are queued or being analysed, counting what is left", () => {
    const running = overview({
      ...countAnalysisProgress(["ANALYZED", "ANALYZING", "QUEUED", "QUEUED"]),
      needsAnalysis: 0,
    });

    expect(analyzeAction(running, null)).toEqual({
      enabled: false,
      busy: true,
      label: "Đang phân tích · còn 3 chương",
      note: null,
    });
  });

  it("is off once nothing is left to analyse, pointing at per-chapter re-analysis or at a waiting CLI task", () => {
    const done = overview({ ...countAnalysisProgress(["ANALYZED", "ANALYZED"]), needsAnalysis: 0 });
    const waiting = overview({ ...countAnalysisProgress(["ANALYZED", "WAITING_FOR_CLI"]), needsAnalysis: 0 });

    expect(analyzeAction(done, null)).toMatchObject({
      enabled: false,
      busy: false,
      label: "Đã phân tích tất cả chương",
    });
    expect(analyzeAction(waiting, null)).toMatchObject({ enabled: false, label: "Đang chờ Claude Code" });
    expect(analyzeAction(waiting, null).note).toContain("1 chương đang chờ bạn chạy lệnh Claude Code");
  });

  it("counts only the chapters a click would queue, and warns when analysed chapters will run again", () => {
    const some = overview({
      ...countAnalysisProgress(["ANALYZED", "ANALYZED", "FAILED", "NOT_ANALYZED"]),
      needsAnalysis: 3,
      outdated: 1,
    });

    expect(analyzeAction(some, null)).toEqual({
      enabled: true,
      busy: false,
      label: "Phân tích 3 chương còn lại",
      note: "1 chương đã phân tích bằng chế độ AI hoặc prompt cũ sẽ được phân tích lại.",
    });
  });
});

describe("analyzeAction with ticked chapters", () => {
  it("queues exactly the ticked chapters, naming how many", () => {
    expect(analyzeAction(overview(), null, 2)).toEqual({
      enabled: true,
      busy: false,
      label: "Phân tích 2 chương đã chọn",
      note: null,
    });
  });

  it("stays usable while the worker is on an earlier run, since ticked chapters are queued behind it", () => {
    const running = overview({
      ...countAnalysisProgress(["ANALYZING", "NOT_ANALYZED", "NOT_ANALYZED"]),
      needsAnalysis: 2,
      needsAnalysisIds: ["c2", "c3"],
    });

    expect(analyzeAction(running, null, 1)).toMatchObject({ enabled: true, busy: false });
    expect(analyzeAction(running, null, 0)).toMatchObject({ enabled: false, busy: true });
  });

  it("goes back to the every-chapter label once nothing is ticked", () => {
    expect(analyzeAction(overview(), null, 0).label).toBe("Phân tích tất cả chương");
  });
});

describe("selectionBlockedNote", () => {
  it("tells a queued chapter from an up-to-date one", () => {
    for (const status of ["QUEUED", "ANALYZING", "WAITING_FOR_CLI"] as const) {
      expect(isAnalysisInProgress(status)).toBe(true);
      expect(selectionBlockedNote(status)).toContain("hàng đợi");
    }
    for (const status of ["ANALYZED", "PARTIAL", "FAILED", "NOT_ANALYZED"] as const) {
      expect(isAnalysisInProgress(status)).toBe(false);
    }
    expect(selectionBlockedNote("ANALYZED")).toContain("Phân tích lại");
  });
});

describe("extractionProgressState", () => {
  it("tells a PDF still being worked on from one that waits for the user, and says nothing once done", () => {
    expect(extractionProgressState(null)).toBeNull();
    expect(extractionProgressState({ status: "COMPLETED", held: false })).toBeNull();
    for (const status of ["QUEUED", "EXTRACTING", "OCR_PENDING", "DETECTING_CHAPTERS"] as const) {
      expect(extractionProgressState({ status, held: false })).toBe("running");
    }
    expect(extractionProgressState({ status: "OCR_PENDING", held: true })).toBe("stopped");
    for (const status of ["NEEDS_CHAPTERS", "PARTIAL", "FAILED", "CANCELLED"] as const) {
      expect(extractionProgressState({ status, held: false })).toBe("stopped");
    }
  });
});
