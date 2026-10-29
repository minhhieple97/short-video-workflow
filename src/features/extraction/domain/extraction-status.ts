export const EXTRACTION_STATUSES = [
  "STAGED",
  "QUEUED",
  "INSPECTING",
  "EXTRACTING",
  "OCR_PENDING",
  "ASSEMBLING",
  // The local parser found no chapter boundary; NotebookLM is asked where chapters start.
  "DETECTING_CHAPTERS",
  // The text is complete but no chapters could be established; a whole-book fallback is never taken as success.
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
  "DETECTING_CHAPTERS",
];

// Every page has its text by now, so OCR (and its ceiling) no longer matters.
export const TEXT_COMPLETE_STATUSES: readonly ExtractionStatus[] = [
  "ASSEMBLING",
  "DETECTING_CHAPTERS",
  "NEEDS_CHAPTERS",
  "COMPLETED",
];

// The original file never changes, so trying again cannot get past these; the book has to be imported again.
const PERMANENT_FAILURE_CODES = new Set(["PDF_ENCRYPTED", "PDF_CORRUPT", "EXTRACTION_NOT_PDF"]);

export function isPermanentExtractionFailure(status: string, errorCode: string | null): boolean {
  return status === "FAILED" && errorCode !== null && PERMANENT_FAILURE_CODES.has(errorCode);
}

export function toExtractionStatus(value: string): ExtractionStatus {
  return EXTRACTION_STATUSES.find((status) => status === value) ?? "FAILED";
}

// Whether a PDF book is still on its way to chapters (the worker has work left) or has stopped and waits for the user.
// Null once the extraction completed, or for a book that was not imported from a PDF.
export function extractionProgressState(
  extraction: { status: ExtractionStatus; held: boolean } | null,
): "running" | "stopped" | null {
  if (!extraction || extraction.status === "COMPLETED") return null;
  return RUNNABLE_EXTRACTION_STATUSES.includes(extraction.status) && !extraction.held ? "running" : "stopped";
}
