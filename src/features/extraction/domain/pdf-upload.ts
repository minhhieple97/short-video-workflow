import { ImportFileError } from "@/features/books/domain/source-file";

const PDF_MAGIC = "%PDF-";
export const PDF_HEAD_BYTES = PDF_MAGIC.length;

export function isPdfFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

export function assertPdfFileName(fileName: string): void {
  if (!isPdfFileName(fileName)) {
    throw new ImportFileError("UNSUPPORTED_FILE_TYPE", "Tên tệp phải có đuôi .pdf.", 415);
  }
}

// Checks the signature on the bytes themselves; the file name and Content-Type are only claims by the client.
export function assertPdfSignature(head: Uint8Array): void {
  const prefix = new TextDecoder("latin1").decode(head.subarray(0, PDF_HEAD_BYTES));
  if (head.byteLength === 0) throw new ImportFileError("EMPTY_FILE", "Tệp PDF không có nội dung.");
  if (prefix !== PDF_MAGIC) {
    throw new ImportFileError("INVALID_PDF", "Tệp không phải PDF hợp lệ (thiếu dấu hiệu %PDF-).", 415);
  }
}
