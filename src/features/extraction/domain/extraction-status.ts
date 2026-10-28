export const EXTRACTION_STATUSES = [
  "QUEUED",
  "INSPECTING",
  "EXTRACTING",
  "OCR_PENDING",
  "ASSEMBLING",
  // The text is complete but no chapter boundaries were found; a whole-book fallback is never taken as success.
  "NEEDS_CHAPTERS",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

// Statuses the extraction job still has work in; anything else waits for the user.
export const RUNNABLE_EXTRACTION_STATUSES: readonly ExtractionStatus[] = [
  "QUEUED",
  "INSPECTING",
  "EXTRACTING",
  "OCR_PENDING",
  "ASSEMBLING",
];

// What a user retry may pick up again: a stopped run, or one held up by a reason the user has since fixed.
export const RETRYABLE_EXTRACTION_STATUSES: readonly ExtractionStatus[] = [
  "FAILED",
  "PARTIAL",
  "CANCELLED",
  "OCR_PENDING",
];

export function toExtractionStatus(value: string): ExtractionStatus {
  return EXTRACTION_STATUSES.find((status) => status === value) ?? "FAILED";
}
