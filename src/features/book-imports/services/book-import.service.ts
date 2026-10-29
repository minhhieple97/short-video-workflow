import "server-only";

import { createHash } from "node:crypto";

import { sanitizeFileName } from "@/features/books/domain/source-file";
import { importPdfBookForBatch } from "@/features/extraction/services/pdf-import.service";
import { listProviderCooldowns } from "@/features/jobs/repositories/provider-cooldown.repository";
import { notebookStudioSettings } from "@/features/notebooklm/services/notebook-studio.service";
import { getAppConfig } from "@/shared/config/env";
import { AppError, NotFoundError } from "@/shared/errors";

import {
  createBookImport,
  findBookImport,
  findBookImportByKey,
  listBookImports,
  rejectBookImportUpload,
  startBookImport,
  type BookImportRecord,
} from "../repositories/book-import.repository";
import type { BookImportDto } from "../schemas/book-import.dto";
import type { CreateBookImport } from "../schemas/book-import.schema";

export async function requireBookImport(id: string): Promise<BookImportRecord> {
  const batch = await findBookImport(id);
  if (!batch) throw new NotFoundError("BOOK_IMPORT_NOT_FOUND", "Không tìm thấy đợt nhập sách.");
  return batch;
}

export async function toBookImportDto(batch: BookImportRecord): Promise<BookImportDto> {
  return {
    id: batch.id,
    status: batch.status,
    minDurationSec: batch.minDurationSec,
    maxDurationSec: batch.maxDurationSec,
    pace: batch.pace,
    items: batch.items.map((item) => {
      const videos = item.productions.flatMap((production) => production.items);
      return {
        id: item.id,
        position: item.position,
        fileName: item.fileName,
        bookId: item.bookId,
        status: item.status,
        errorMessage: item.errorMessage,
        productionIds: item.productions.map((production) => production.id),
        videosCompleted: videos.filter((video) => video.status === "COMPLETED").length,
        videosTotal: videos.length,
      };
    }),
    cooldowns: (await listProviderCooldowns()).map((cooldown) => ({
      provider: cooldown.provider,
      message: cooldown.message,
      blockedUntil: cooldown.blockedUntil.toISOString(),
    })),
  };
}

export async function requestBookImport(input: CreateBookImport): Promise<BookImportDto> {
  const config = getAppConfig();
  if (config.ai.mode !== "mock" && (config.ai.mode !== "cli-auto" || !notebookStudioSettings())) {
    throw new AppError(
      "BOOK_IMPORT_NOT_CONFIGURED",
      "Đợt nhập tự động cần Claude Code chạy tự động và NotebookLM đã được cấu hình trong Cài đặt.",
      409,
    );
  }
  if (config.tts.mode === "upload")
    throw new AppError("TTS_DISABLED", "Đợt nhập tự động cần bật tạo giọng đọc trong Cài đặt.", 409);
  if (input.maxDurationSec > config.video.maxDurationSec)
    throw new AppError("DURATION_NOT_ALLOWED", "Thời lượng vượt giới hạn đã cấu hình.", 400);
  const settings = {
    ...input,
    fileNames: input.fileNames.map(sanitizeFileName),
    pace: input.pace ?? config.video.defaultPace,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ...settings, idempotencyKey: undefined }))
    .digest("hex");
  const previous = await findBookImportByKey(input.idempotencyKey);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new AppError("IDEMPOTENCY_KEY_REUSED", "Khoá này đã dùng cho đợt nhập khác.", 409);
    return toBookImportDto(previous);
  }
  try {
    return await toBookImportDto(await createBookImport({ ...settings, fingerprint }));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const winner = await findBookImportByKey(input.idempotencyKey);
      if (winner?.fingerprint === fingerprint) return toBookImportDto(winner);
    }
    throw error;
  }
}

export async function uploadBookImportFile(batchId: string, itemId: string, request: Request) {
  const batch = await requireBookImport(batchId);
  const item = batch.items.find((row) => row.id === itemId);
  if (!item) throw new NotFoundError("BOOK_IMPORT_FILE_NOT_FOUND", "Không tìm thấy tệp trong đợt nhập.");
  if (batch.status !== "UPLOADING") throw new AppError("BOOK_IMPORT_CLOSED", "Đợt nhập đã đóng tải lên.", 409);
  if (item.bookId) return { bookId: item.bookId, reused: true };
  const limit = getAppConfig().pdf.maxSizeBytes;
  if (Number(request.headers.get("content-length") ?? "0") > limit)
    throw new AppError("FILE_TOO_LARGE", "Tệp PDF vượt giới hạn cho phép.", 413);
  if (!request.body) throw new AppError("EMPTY_FILE", "Tệp PDF không có nội dung.", 400);
  try {
    return await importPdfBookForBatch({
      fileName: item.fileName,
      body: request.body,
      signal: request.signal,
      batchItemId: item.id,
    });
  } catch (error) {
    if (error instanceof AppError && [400, 409, 413, 415, 422].includes(error.httpStatus))
      await rejectBookImportUpload(item.id, error);
    throw error;
  }
}

export async function beginBookImport(id: string): Promise<BookImportDto> {
  await requireBookImport(id);
  await startBookImport(id);
  return getBookImport(id);
}

export async function getBookImport(id: string): Promise<BookImportDto> {
  return toBookImportDto(await requireBookImport(id));
}

export async function getBookImports(): Promise<BookImportDto[]> {
  return Promise.all((await listBookImports()).map(toBookImportDto));
}
