export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDataDirs } = await import("@/server/storage/paths");
    ensureDataDirs();
  }
}
