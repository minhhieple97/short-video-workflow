import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";
import { getAppConfig } from "@/shared/config/env";

const FILE_URL_PREFIX = "file:";

export function resolveDatabaseFile(databaseUrl: string = getAppConfig().databaseUrl): string {
  // Runtime data location, not source to bundle: keep Turbopack from tracing the whole project.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), databaseUrl.slice(FILE_URL_PREFIX.length));
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: `${FILE_URL_PREFIX}${resolveDatabaseFile()}` });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (getAppConfig().nodeEnv !== "production") {
  globalForPrisma.prisma = prisma;
}

// WAL lets the web process and the worker share the SQLite file without writer/reader blocking.
export async function configureDatabase(): Promise<void> {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
}
