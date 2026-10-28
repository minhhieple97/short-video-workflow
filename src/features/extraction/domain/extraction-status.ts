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

// The original file never changes, so trying again cannot get past these; the book has to be imported again.
const PERMANENT_FAILURE_CODES = new Set(["PDF_ENCRYPTED", "PDF_CORRUPT", "EXTRACTION_NOT_PDF"]);

export function isPermanentExtractionFailure(status: string, errorCode: string | null): boolean {
  return status === "FAILED" && errorCode !== null && PERMANENT_FAILURE_CODES.has(errorCode);
}

export function toExtractionStatus(value: string): ExtractionStatus {
  return EXTRACTION_STATUSES.find((status) => status === value) ?? "FAILED";
}
