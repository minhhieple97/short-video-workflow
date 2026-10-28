import type { ExtractionStatus } from "../domain/extraction-status";

export interface ExtractionPageCounts {
  // Pages whose text layer was used as is.
  text: number;
  // Pages read by OCR.
  ocr: number;
  // Valid blank pages.
  empty: number;
  // Waiting to be sent to OCR, or sent and not back yet.
  waitingOcr: number;
  sentToOcr: number;
  failed: number;
}

export interface ExtractionDto {
  id: string;
  bookId: string;
  status: ExtractionStatus;
  // Known once the PDF has been inspected.
  pageCount: number | null;
  pages: ExtractionPageCounts;
  // The first failed pages, in order, for the message shown to the user.
  failedPages: number[];
  ocr: {
    provider: string | null;
    model: string | null;
    ceilingMicroUsd: number | null;
    reservedMicroUsd: number;
    spentMicroUsd: number;
    // The batch currently at the provider, if any.
    openBatch: { status: string; pageCount: number; submittedAt: string | null; lastPolledAt: string | null } | null;
  };
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  activeJob: { id: string; status: string } | null;
  // Stopped with a reason the user has to act on (no key, budget, refused key…), not merely waiting.
  held: boolean;
  canRetry: boolean;
  canSetCeiling: boolean;
}
