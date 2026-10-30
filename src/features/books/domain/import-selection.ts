import { formatBytes } from "@/lib/format";

export function importSelectionError(
  files: readonly { name: string; size: number }[],
  limits: { maxPdfBytes: number; maxTextBytes: number; maxPdfFiles: number },
): string | null {
  if (files.length === 0) return null;
  const pdf = files.every((file) => /\.pdf$/i.test(file.name));
  if (!pdf && files.length > 1) return "Chọn nhiều tệp chỉ áp dụng cho PDF. TXT hoặc Markdown cần nhập từng sách.";
  if (pdf && files.length > limits.maxPdfFiles) return `Tối đa ${limits.maxPdfFiles} tệp PDF mỗi lần nhập.`;
  const invalid = files.find((file) => !/\.(pdf|md|markdown|txt)$/i.test(file.name));
  if (invalid) return `Tệp “${invalid.name}” không được hỗ trợ. Hãy chọn PDF, TXT hoặc Markdown.`;
  const limit = pdf ? limits.maxPdfBytes : limits.maxTextBytes;
  const oversized = files.find((file) => file.size === 0 || file.size > limit);
  return oversized ? `Tệp “${oversized.name}” cần có nội dung và không vượt quá ${formatBytes(limit)}.` : null;
}
