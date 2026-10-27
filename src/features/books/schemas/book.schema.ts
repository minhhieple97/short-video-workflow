import { z } from "zod";

const title = z.string().trim().min(1, "Tiêu đề không được để trống.").max(200, "Tiêu đề tối đa 200 ký tự.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự.`)
    .optional()
    .transform((value) => (value ? value : null));

export const pastedImportSchema = z.object({
  text: z.string().min(1, "Hãy dán nội dung sách."),
  format: z.enum(["md", "txt"]),
});

export const confirmImportSchema = z.object({
  importId: z.uuid("Mã phiên nhập không hợp lệ."),
  title,
  author: optionalText(200),
  description: optionalText(2000),
  allowDuplicate: z.boolean().default(false),
  chapters: z
    .array(
      z.object({
        title,
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      }),
    )
    .min(1, "Cần ít nhất một chương.")
    .max(500, "Tối đa 500 chương."),
});

export const updateBookSchema = z.object({
  title,
  author: optionalText(200),
  description: optionalText(2000),
});

export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;
export type UpdateBookInput = z.infer<typeof updateBookSchema>;
