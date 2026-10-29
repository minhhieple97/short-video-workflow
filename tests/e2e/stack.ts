import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OFFLINE_INTEGRATIONS_ENV } from "../helpers/offline-env";

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "book-video-studio-e2e");

// Isolated database, data folder and Redis logical DB so the smoke test never touches real work, and no integration
// account: these values win over the developer's .env, which the web and worker processes would otherwise read.
export const E2E_ENV: Record<string, string> = {
  ...OFFLINE_INTEGRATIONS_ENV,
  NODE_ENV: "production",
  DATABASE_URL: `file:${path.join(E2E_DATA_DIR, "e2e.db")}`,
  DATA_DIR: E2E_DATA_DIR,
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379/14",
  // Batch production voices scenes with edge-tts; start-stack points it at a fake that writes real MP3s. Uploading audio
  // (the manual flow of E2E-01) works in every mode.
  TTS_MODE: "edge-tts",
};

export function findRemotionChromium(): string | undefined {
  const root = path.join(process.cwd(), "node_modules", ".remotion");
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop() ?? "";
    for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) {
      const full = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === "chrome-headless-shell") return full;
      if (entry.isDirectory()) stack.push(full);
    }
  }
  return undefined;
}
