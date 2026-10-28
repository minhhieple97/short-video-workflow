import type { ArchiveFolderStore } from "@/server/archive/google-drive/drive-folder-tree";
import { prisma } from "@/server/db/client";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function archiveFolderStore(provider: string, destinationKey: string): ArchiveFolderStore {
  const destination = { provider, destinationKey };
  return {
    async find(paths) {
      const rows = await prisma.archiveFolder.findMany({ where: { ...destination, path: { in: [...paths] } } });
      return rows.map((row) => ({ path: row.path, remoteId: row.remoteId, confirmed: row.confirmedAt !== null }));
    },

    async reserve(path, remoteId) {
      try {
        const row = await prisma.archiveFolder.create({ data: { ...destination, path, remoteId } });
        return row.remoteId;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = await prisma.archiveFolder.findUnique({
          where: { provider_destinationKey_path: { ...destination, path } },
        });
        if (!winner) throw error;
        return winner.remoteId;
      }
    },

    async confirm(path) {
      await prisma.archiveFolder.updateMany({
        where: { ...destination, path, confirmedAt: null },
        data: { confirmedAt: new Date() },
      });
    },

    async forget(path) {
      await prisma.archiveFolder.deleteMany({
        where: { ...destination, OR: [{ path }, { path: { startsWith: path === "" ? "" : `${path}/` } }] },
      });
    },
  };
}
