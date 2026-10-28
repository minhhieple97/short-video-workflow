import { describe, expect, it } from "vitest";

import { extractionSteps } from "@/features/extraction/domain/extraction-labels";
import type { ExtractionStatus } from "@/features/extraction/domain/extraction-status";

const states = (status: ExtractionStatus, options: { hasPages?: boolean; held?: boolean } = {}) =>
  extractionSteps({ status, hasPages: options.hasPages ?? true, held: options.held ?? false }).map(
    (step) => `${step.key}:${step.state}`,
  );

describe("extractionSteps", () => {
  it("follows a run through its four steps", () => {
    expect(states("QUEUED", { hasPages: false })).toEqual([
      "read:current",
      "ocr:todo",
      "assemble:todo",
      "chapters:todo",
    ]);
    expect(states("OCR_PENDING")).toEqual(["read:done", "ocr:current", "assemble:todo", "chapters:todo"]);
    expect(states("ASSEMBLING")).toEqual(["read:done", "ocr:done", "assemble:current", "chapters:todo"]);
    expect(states("COMPLETED")).toEqual(["read:done", "ocr:done", "assemble:done", "chapters:done"]);
  });

  it("shows where a stopped run is stuck", () => {
    expect(states("OCR_PENDING", { held: true })).toEqual([
      "read:done",
      "ocr:blocked",
      "assemble:todo",
      "chapters:todo",
    ]);
    expect(states("PARTIAL")).toEqual(["read:done", "ocr:blocked", "assemble:todo", "chapters:todo"]);
    expect(states("NEEDS_CHAPTERS")).toEqual(["read:done", "ocr:done", "assemble:done", "chapters:blocked"]);
  });

  it("places a failed or cancelled run at reading until its pages were read", () => {
    expect(states("FAILED", { hasPages: false })).toEqual([
      "read:blocked",
      "ocr:todo",
      "assemble:todo",
      "chapters:todo",
    ]);
    expect(states("CANCELLED", { hasPages: true })).toEqual([
      "read:done",
      "ocr:blocked",
      "assemble:todo",
      "chapters:todo",
    ]);
  });
});
