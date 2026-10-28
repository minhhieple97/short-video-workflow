import { z } from "zod";

export const pdfImportQuerySchema = z.object({
  fileName: z.string().trim().min(1, "Thiếu tên tệp PDF.").max(255),
  title: z.string().trim().min(1).max(200).optional(),
});

export type PdfImportQuery = z.infer<typeof pdfImportQuerySchema>;
