import { randomUUID } from "node:crypto";

import type { NotebookBinding, NotebookSourceBinding } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import { titleWithMarker } from "../domain/binding-marker";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// One notebook per book and NotebookLM account; asking again returns the same binding.
export async function ensureNotebookBinding(bookId: string, profile: string): Promise<NotebookBinding> {
  const existing = await prisma.notebookBinding.findUnique({ where: { bookId_profile: { bookId, profile } } });
  if (existing) return existing;
  try {
    return await prisma.notebookBinding.create({ data: { bookId, profile } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return prisma.notebookBinding.findUniqueOrThrow({ where: { bookId_profile: { bookId, profile } } });
  }
}

export function findNotebookBinding(id: string): Promise<NotebookBinding | null> {
  return prisma.notebookBinding.findUnique({ where: { id } });
}

export async function moveNotebookStatus(id: string, from: readonly string[], to: string): Promise<boolean> {
  const { count } = await prisma.notebookBinding.updateMany({
    where: { id, status: { in: [...from] } },
    data: { status: to },
  });
  return count > 0;
}

// The remote notebook ID is written once; a later answer never replaces it.
export async function saveNotebookId(id: string, notebookId: string): Promise<NotebookBinding> {
  await prisma.notebookBinding.updateMany({ where: { id, notebookId: null }, data: { notebookId, status: "READY" } });
  return prisma.notebookBinding.findUniqueOrThrow({ where: { id } });
}

export async function saveChatPersonaVersion(id: string, version: string): Promise<void> {
  await prisma.notebookBinding.update({ where: { id }, data: { chatPersonaVersion: version } });
}

// The binding for this part of the book at this revision. Text that changed gets a new binding and the earlier revision
// is marked superseded (kept, with its remote ID); text that went back to an earlier revision reuses that binding.
export function ensureSourceBinding(input: {
  notebookBindingId: string;
  sourceKey: string;
  contentHash: string;
  title: string;
}): Promise<NotebookSourceBinding> {
  const { notebookBindingId, sourceKey, contentHash } = input;
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    // Superseding the other revisions first takes the write lock, so two callers cannot both create this revision.
    await tx.notebookSourceBinding.updateMany({
      where: { notebookBindingId, sourceKey, contentHash: { not: contentHash }, supersededAt: null },
      data: { supersededAt: now },
    });
    const existing = await tx.notebookSourceBinding.findUnique({
      where: { notebookBindingId_sourceKey_contentHash: { notebookBindingId, sourceKey, contentHash } },
    });
    if (existing) {
      if (!existing.supersededAt) return existing;
      return tx.notebookSourceBinding.update({ where: { id: existing.id }, data: { supersededAt: null } });
    }
    const id = randomUUID();
    return tx.notebookSourceBinding.create({
      data: { id, notebookBindingId, sourceKey, contentHash, title: titleWithMarker(input.title, id) },
    });
  });
}

export function findSourceBinding(id: string): Promise<NotebookSourceBinding | null> {
  return prisma.notebookSourceBinding.findUnique({ where: { id } });
}

export async function moveSourceStatus(id: string, from: readonly string[], to: string): Promise<boolean> {
  const { count } = await prisma.notebookSourceBinding.updateMany({
    where: { id, status: { in: [...from] } },
    data: { status: to },
  });
  return count > 0;
}

// The remote source ID is written once; a later answer never replaces it.
export async function saveRemoteSourceId(
  id: string,
  remoteSourceId: string,
  now = new Date(),
): Promise<NotebookSourceBinding> {
  await prisma.notebookSourceBinding.updateMany({
    where: { id, remoteSourceId: null },
    data: { remoteSourceId, status: "READY", readyAt: now },
  });
  return prisma.notebookSourceBinding.findUniqueOrThrow({ where: { id } });
}

// The sources a question should be asked against: the current revision of every part of the book.
export function listCurrentSources(notebookBindingId: string): Promise<NotebookSourceBinding[]> {
  return prisma.notebookSourceBinding.findMany({
    where: { notebookBindingId, supersededAt: null },
    orderBy: { sourceKey: "asc" },
  });
}
