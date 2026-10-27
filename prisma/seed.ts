import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { confirmImport, previewImport } from "@/features/books/services/book-import.service";
import { discardStagedImport } from "@/features/books/services/import-staging";
import { runChapterAnalysis } from "@/features/chapters/services/chapter-analysis.service";
import { listChapters } from "@/features/chapters/services/chapter.service";
import { MockAiProvider } from "@/server/ai/mock-ai-provider";
import { configureDatabase, prisma } from "@/server/db/client";
import { ensureDataDirs } from "@/server/storage/paths";

const SAMPLE_BOOK = path.join(import.meta.dirname, "seed-data", "atomic-habits-sample.md");

async function seedSampleBook(): Promise<string> {
  const preview = await previewImport({
    kind: "file",
    fileName: path.basename(SAMPLE_BOOK),
    mimeType: "text/markdown",
    bytes: new Uint8Array(fs.readFileSync(SAMPLE_BOOK)),
  });

  if (preview.duplicateOf) {
    await discardStagedImport(preview.importId);
    console.log(`Sách mẫu đã có: "${preview.duplicateOf.title}" (${preview.duplicateOf.id}).`);
    return preview.duplicateOf.id;
  }

  const { bookId } = await confirmImport({
    importId: preview.importId,
    title: preview.suggestedTitle,
    author: "James Clear",
    description: "Bản tóm lược minh họa dùng để demo và kiểm thử, không phải trích nguyên văn.",
    allowDuplicate: false,
    chapters: preview.sections
      .filter((section) => section.include)
      .map(({ title, start, end }) => ({ title, start, end })),
  });
  console.log(`Đã nhập sách mẫu "${preview.suggestedTitle}" (${bookId}).`);
  return bookId;
}

// Always uses the mock provider so seeding never spends Claude quota; already-analysed chapters are skipped.
async function seedDraftLessons(bookId: string): Promise<void> {
  const provider = new MockAiProvider();
  for (const chapter of await listChapters(bookId)) {
    const result = await runChapterAnalysis({ chapterId: chapter.id, jobRecordId: null, force: false, provider });
    console.log(
      result.skipped
        ? `Chương ${chapter.order}: đã có bài học mẫu.`
        : `Chương ${chapter.order}: tạo ${result.lessonsCreated} bài học nháp (AI mẫu).`,
    );
  }
}

async function main(): Promise<void> {
  ensureDataDirs();
  await configureDatabase();
  const bookId = await seedSampleBook();
  await seedDraftLessons(bookId);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
