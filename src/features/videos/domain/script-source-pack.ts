import { z } from "zod";
import { locateExcerpt } from "@/features/lessons/domain/source-excerpts";

export const SOURCE_CONTEXT_CHARS = 2_000;
export const SOURCE_PACK_MAX_CHARS = 40_000;
export const scriptSourcePackSchema = z.object({
  version: z.literal("script-source-pack-v1"),
  bookId: z.string().min(1),
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        lessonIds: z.array(z.string()).min(1),
        chapterId: z.string(),
        chapterTitle: z.string(),
        chapterHash: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        page: z.number().int().positive().nullable(),
        endPage: z.number().int().positive().nullable(),
        pages: z
          .array(
            z.object({
              page: z.number().int().positive().nullable(),
              start: z.number().int().nonnegative(),
              end: z.number().int().positive(),
            }),
          )
          .optional(),
        text: z.string().min(8),
        excerpt: z.string().min(8),
      }),
    )
    .min(1),
});
export type ScriptSourcePack = z.infer<typeof scriptSourcePackSchema>;
export const normalizedSourceText = (text: string): string => text.normalize("NFC").replace(/\s+/g, " ").trim();

export function sourceReferencesProblem(
  pack: ScriptSourcePack,
  references: readonly { sourceId: string; page: number | null; text: string }[],
): string | null {
  for (const reference of references) {
    const source = pack.sources.find((candidate) => candidate.id === reference.sourceId);
    const offset = source ? locateExcerpt(source.text, reference.text) : null;
    if (!source || offset === null) return "Trích dẫn không có trong gói nguồn đã kiểm chứng.";
    const page = source.pages?.find((span) => span.start <= offset && offset < span.end)?.page ?? source.page;
    if (reference.page !== page) return "Trang trích dẫn không khớp gói nguồn.";
  }
  return null;
}
