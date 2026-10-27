import fs from "node:fs/promises";

import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";

import type { SourceFormat } from "../domain/source-file";

const READ_ONLY = 0o444;

export const bookDirectory = (bookId: string) => `books/${bookId}`;
export const originalFilePath = (bookId: string, format: SourceFormat) => `${bookDirectory(bookId)}/original.${format}`;
export const chapterFilePath = (bookId: string, chapterId: string) =>
  `${bookDirectory(bookId)}/chapters/${chapterId}.md`;

// The original upload is the immutable source of truth: written once, byte for byte, then made read-only.
export async function writeOriginalFile(relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = dataPath(relativePath);
  await writeFileAtomic(target, bytes);
  await fs.chmod(target, READ_ONLY);
}

export async function writeChapterFile(relativePath: string, content: string): Promise<void> {
  await writeFileAtomic(dataPath(relativePath), `${content}\n`);
}

export async function readDataFile(relativePath: string): Promise<string> {
  return fs.readFile(dataPath(relativePath), "utf8");
}

export async function removeBookDirectory(bookId: string): Promise<void> {
  await fs.rm(dataPath(bookDirectory(bookId)), { recursive: true, force: true });
}
