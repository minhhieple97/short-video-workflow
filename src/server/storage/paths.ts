import fs from "node:fs";
import path from "node:path";

import { getAppConfig } from "@/shared/config/env";

import { resolveWithinRoot } from "./safe-path";

export const DATA_SUBDIRECTORIES = ["books", "ai-tasks", "videos", "diagnostics"] as const;

export class DataDirError extends Error {
  readonly code = "INVALID_DATA_DIR";
}

export function resolveDataDir(configuredDir: string = getAppConfig().dataDir): string {
  // Runtime data location, not source to bundle: keep Turbopack from tracing the whole project.
  const absolute = path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredDir);
  if (absolute === "/mnt" || absolute.startsWith("/mnt/")) {
    throw new DataDirError(
      `DATA_DIR resolves to ${absolute}, a Windows-mounted path. Keep data on the Linux filesystem (e.g. inside the project folder).`,
    );
  }
  return absolute;
}

export function dataPath(...segments: string[]): string {
  return resolveWithinRoot(resolveDataDir(), path.join(...segments));
}

export function ensureDataDirs(): string {
  const root = resolveDataDir();
  fs.mkdirSync(/* turbopackIgnore: true */ root, { recursive: true });
  for (const name of DATA_SUBDIRECTORIES) {
    fs.mkdirSync(path.join(/* turbopackIgnore: true */ root, name), { recursive: true });
  }
  return root;
}
