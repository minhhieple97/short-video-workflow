import "dotenv/config";

import { listPdfBooks } from "../src/features/extraction/repositories/text-layer-repair.repository";
import {
  applyTextLayerRepair,
  planTextLayerRepair,
  type TextLayerRepairPlan,
} from "../src/features/extraction/services/text-layer-repair.service";
import { prisma } from "../src/server/db/client";
import { AppError } from "../src/shared/errors";

const USAGE = "Dùng: pnpm text:repair [--book <bookId>] [--apply]";

function parseArguments(args: readonly string[]): { bookId: string | null; apply: boolean } {
  let bookId: string | null = null;
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") apply = true;
    else if (argument === "--book" && args[index + 1]) bookId = args[(index += 1)] ?? null;
    else throw new AppError("INVALID_ARGUMENTS", USAGE);
  }
  return { bookId, apply };
}

const number = (value: number) => value.toLocaleString("vi-VN");

function describe(plan: TextLayerRepairPlan): string[] {
  const lines = [
    `  Cần sửa ${number(plan.repairedCharacters)} chữ đ/Đ bị đọc sai: ${number(plan.pages.length)} trang, ` +
      `${number(plan.chapters.length)} chương (${number(plan.renamedChapters)} tên chương), ` +
      `${number(plan.excerpts.length)} trích dẫn bài học.`,
  ];
  if (plan.analyses.length > 0) {
    lines.push(`  Giữ trạng thái "đã phân tích" cho ${number(plan.analyses.length)} lần phân tích chương.`);
  }
  for (const skipped of plan.skippedChapters) lines.push(`  Bỏ qua chương ${skipped.order}: ${skipped.reason}`);
  return lines;
}

async function main(): Promise<void> {
  const { bookId, apply } = parseArguments(process.argv.slice(2));
  const books = (await listPdfBooks()).filter((book) => bookId === null || book.id === bookId);
  if (books.length === 0) throw new AppError("BOOK_NOT_FOUND", "Không có sách PDF nào khớp.");

  let pending = 0;
  for (const book of books) {
    console.log(`${book.title} (${book.id})`);
    const outcome = await planTextLayerRepair(book);
    if (outcome.kind !== "READY") {
      console.log(`  ${outcome.kind === "BLOCKED" ? "Chưa sửa được" : "Không cần sửa"}: ${outcome.reason}`);
      continue;
    }
    describe(outcome.plan).forEach((line) => console.log(line));
    if (!apply) {
      pending += 1;
      continue;
    }
    const { backupDir } = await applyTextLayerRepair(outcome.plan);
    console.log(`  Đã sửa. Bản sao lưu cơ sở dữ liệu và file cũ: ${backupDir}`);
  }
  if (pending > 0) console.log(`\nChưa sửa gì. Chạy lại với --apply để sửa ${pending} sách (có sao lưu trước).`);
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof AppError
        ? error.message
        : `Không sửa được chữ (${error instanceof Error ? error.name : "lỗi lạ"}); kiểm tra cơ sở dữ liệu rồi chạy lại.`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
