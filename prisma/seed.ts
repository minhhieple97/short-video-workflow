import "dotenv/config";

import { configureDatabase, prisma } from "@/server/db/client";
import { ensureDataDirs } from "@/server/storage/paths";

async function main(): Promise<void> {
  ensureDataDirs();
  await configureDatabase();
  const books = await prisma.book.count();
  console.log(`Cơ sở dữ liệu sẵn sàng (${books} sách). Dữ liệu demo sẽ được bổ sung ở M1–M2.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
