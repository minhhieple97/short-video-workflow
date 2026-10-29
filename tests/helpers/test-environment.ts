import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OFFLINE_INTEGRATIONS_ENV } from "./offline-env";

export interface TestEnvironment {
  dataDir: string;
  cleanup: () => void;
}

// Points the app at a throwaway SQLite file and DATA_DIR, then applies the real migrations.
// Call before importing any module that reads the app config.
export function setupTestEnvironment(): TestEnvironment {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bvs-test-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.closeSync(fs.openSync(path.join(dataDir, "test.db"), "a"));

  Object.assign(process.env, {
    ...OFFLINE_INTEGRATIONS_ENV,
    NODE_ENV: "test",
    DATABASE_URL: `file:${path.join(dataDir, "test.db")}`,
    DATA_DIR: dataDir,
    REDIS_URL: "redis://127.0.0.1:6399",
  });
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: process.env, stdio: "pipe" });

  return { dataDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export const SAMPLE_BOOK_PATH = path.join(import.meta.dirname, "../../prisma/seed-data/atomic-habits-sample.md");
