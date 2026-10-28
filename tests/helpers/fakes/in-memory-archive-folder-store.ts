import type { ArchiveFolderBinding, ArchiveFolderStore } from "@/server/archive/google-drive/drive-folder-tree";

// Same rules as the SQLite store (write-once IDs, forget a path and what is below it), kept in memory for adapter tests.
export class InMemoryArchiveFolderStore implements ArchiveFolderStore {
  private readonly bindings = new Map<string, ArchiveFolderBinding>();

  async find(paths: readonly string[]): Promise<ArchiveFolderBinding[]> {
    return paths.flatMap((path) => {
      const binding = this.bindings.get(path);
      return binding ? [{ ...binding }] : [];
    });
  }

  async reserve(path: string, remoteId: string): Promise<string> {
    const existing = this.bindings.get(path);
    if (existing) return existing.remoteId;
    this.bindings.set(path, { path, remoteId, confirmed: false });
    return remoteId;
  }

  async confirm(path: string): Promise<void> {
    const binding = this.bindings.get(path);
    if (binding) binding.confirmed = true;
  }

  async forget(path: string): Promise<void> {
    for (const key of [...this.bindings.keys()]) {
      if (key === path || path === "" || key.startsWith(`${path}/`)) this.bindings.delete(key);
    }
  }
}
