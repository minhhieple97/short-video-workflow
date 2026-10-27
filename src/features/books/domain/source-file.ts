import { AppError } from "@/shared/errors";

export type SourceFormat = "md" | "txt";

const EXTENSION_FORMATS: Record<string, SourceFormat> = {
  ".md": "md",
  ".markdown": "md",
  ".txt": "txt",
};

const ACCEPTED_MIME_TYPES = new Set(["", "text/plain", "text/markdown", "text/x-markdown", "application/octet-stream"]);

const BINARY_SNIFF_BYTES = 8192;

export class ImportFileError extends AppError {
  constructor(code: string, message: string, httpStatus = 400) {
    super(code, message, httpStatus);
    this.name = "ImportFileError";
  }
}

export function sanitizeFileName(rawName: string): string {
  const baseName = rawName.split(/[\\/]/).pop() ?? "";
  const cleaned = baseName.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, 200) || "khong-ten.txt";
}

export function detectSourceFormat(fileName: string): SourceFormat {
  const dotIndex = fileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
  const format = EXTENSION_FORMATS[extension];
  if (!format) {
    throw new ImportFileError(
      "UNSUPPORTED_FILE_TYPE",
      "Chỉ hỗ trợ tệp .md hoặc .txt (PDF/EPUB chưa được hỗ trợ).",
      415,
    );
  }
  return format;
}

export function assertAcceptedMimeType(mimeType: string): void {
  if (!ACCEPTED_MIME_TYPES.has(mimeType.split(";")[0]?.trim().toLowerCase() ?? "")) {
    throw new ImportFileError(
      "UNSUPPORTED_FILE_TYPE",
      `Loại tệp "${mimeType}" không được hỗ trợ. Chỉ nhận .md hoặc .txt.`,
      415,
    );
  }
}

export function assertWithinSizeLimit(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes > maxBytes) {
    const maxMb = Math.round((maxBytes / 1024 / 1024) * 10) / 10;
    throw new ImportFileError("FILE_TOO_LARGE", `Tệp vượt quá giới hạn ${maxMb} MB.`, 413);
  }
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

// Derived text only: CRLF/CR → LF, BOM removed, Unicode NFC so Vietnamese matching is stable. The stored original is untouched.
export function decodeSourceText(bytes: Uint8Array): string {
  if (startsWithBytes(bytes, PDF_SIGNATURE)) {
    throw new ImportFileError("UNSUPPORTED_FILE_TYPE", "Tệp PDF chưa được hỗ trợ. Hãy chuyển sang .md hoặc .txt.", 415);
  }
  if (startsWithBytes(bytes, ZIP_SIGNATURE)) {
    throw new ImportFileError("UNSUPPORTED_FILE_TYPE", "Tệp nén (EPUB/DOCX/ZIP) không được hỗ trợ.", 415);
  }
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    throw new ImportFileError("BINARY_FILE", "Tệp có vẻ là nhị phân hoặc không phải UTF-8 (ví dụ UTF-16).", 415);
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFileError("INVALID_ENCODING", "Tệp không phải văn bản UTF-8 hợp lệ.", 415);
  }

  const text = decoded.replace(/\r\n?/g, "\n").normalize("NFC");
  if (text.trim().length === 0) {
    throw new ImportFileError("EMPTY_FILE", "Tệp không có nội dung.");
  }
  return text;
}

export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const title = withoutExtension.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return title || "Sách chưa đặt tên";
}
