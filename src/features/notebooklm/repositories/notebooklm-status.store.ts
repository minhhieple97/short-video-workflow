import fs from "node:fs/promises";

import { z } from "zod";

import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";

import type { NotebookLmStatusDto } from "../schemas/notebooklm-status.dto";

const STATUS_FILE = ["integrations", "notebooklm-status.json"] as const;

const statusSchema = z.object({
  checkedAt: z.string(),
  profile: z.string(),
  state: z.enum(["OK", "NEEDS_LOGIN", "ERROR"]),
  message: z.string().nullable(),
  tier: z.string().nullable(),
  windows: z.array(
    z.object({
      window: z.string(),
      percentUsed: z.number().nullable(),
      percentRemaining: z.number().nullable(),
      resetsAt: z.string().nullable(),
    }),
  ),
});

// A file under DATA_DIR rather than a table: it is one small, replaceable observation the worker writes and the web reads.
export async function readNotebookLmStatus(): Promise<NotebookLmStatusDto | null> {
  let raw: string;
  try {
    raw = await fs.readFile(dataPath(...STATUS_FILE), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = statusSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeNotebookLmStatus(status: NotebookLmStatusDto): Promise<void> {
  await writeFileAtomic(dataPath(...STATUS_FILE), `${JSON.stringify(statusSchema.parse(status), null, 2)}\n`);
}
