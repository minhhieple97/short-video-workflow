import type { DurationRange } from "@/features/videos/domain/duration";
import type { Pace } from "@/features/videos/domain/pace";

export interface PdfImportSettings {
  maxPdfBytes: number;
  defaultRange: DurationRange;
  defaultPace: Pace;
  ceilingSec: number;
}

export interface BookImportDto {
  id: string;
  status: string;
  minDurationSec: number;
  maxDurationSec: number;
  pace: string;
  items: {
    id: string;
    position: number;
    fileName: string;
    bookId: string | null;
    status: string;
    errorMessage: string | null;
    productionIds: string[];
    videosCompleted: number;
    videosTotal: number;
  }[];
  cooldowns: { provider: string; message: string; blockedUntil: string }[];
}
