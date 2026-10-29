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
