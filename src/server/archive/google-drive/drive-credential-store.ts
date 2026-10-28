import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "@/server/storage/atomic-write";
import { dataPath } from "@/server/storage/paths";
import { AppError } from "@/shared/errors";

const driveCredentialSchema = z.object({
  // NEEDS_RECONNECT: Google refused the refresh token (revoked, expired, password change); only a new sign-in helps.
  status: z.enum(["CONNECTED", "NEEDS_RECONNECT"]).default("CONNECTED"),
  refreshToken: z.string().min(1),
  scope: z.string(),
  accessToken: z.string().min(1).nullable(),
  accessTokenExpiresAt: z.iso.datetime().nullable(),
  accountId: z.string().min(1).nullable(),
  accountEmail: z.string().min(1).nullable(),
  connectedAt: z.iso.datetime(),
});

export type DriveCredential = z.output<typeof driveCredentialSchema>;

// Kept out of SQLite on purpose: database copies, exports and diagnostics never contain the tokens. Only this process's
// user can read the file or list its directory.
export function driveCredentialPath(): string {
  return dataPath("credentials", "google-drive.json");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function readDriveCredential(): Promise<DriveCredential | null> {
  let raw: string;
  try {
    raw = await fs.readFile(driveCredentialPath(), "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = driveCredentialSchema.safeParse(json);
  // The message never repeats the file's content: it holds the tokens.
  if (!parsed.success) {
    throw new AppError(
      "DRIVE_CREDENTIAL_INVALID",
      "Tệp thông tin đăng nhập Google Drive bị hỏng; hãy kết nối lại.",
      409,
    );
  }
  return parsed.data;
}

// Changes the stored connection only if it is still the one the caller read (same sign-in). A refresh that finishes after
// the user disconnected or signed in again therefore cannot bring back the old connection.
export async function updateDriveCredential(
  connectedAt: string,
  change: (credential: DriveCredential) => DriveCredential,
): Promise<DriveCredential | null> {
  const current = await readDriveCredential();
  if (!current || current.connectedAt !== connectedAt) return null;
  const next = change(current);
  await writeDriveCredential(next);
  return next;
}

export async function writeDriveCredential(credential: DriveCredential): Promise<void> {
  const target = driveCredentialPath();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(target), 0o700);
  await writeFileAtomic(target, JSON.stringify(driveCredentialSchema.parse(credential)), { mode: 0o600 });
}

export async function deleteDriveCredential(): Promise<void> {
  await fs.rm(driveCredentialPath(), { force: true });
}
