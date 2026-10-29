import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as DriveOverview from "@/features/drive/services/drive-overview.service";
import type * as CredentialStore from "@/server/archive/google-drive/drive-credential-store";
import type * as DbClient from "@/server/db/client";
import type * as DriveCheck from "@/server/diagnostics/checks/google-drive";
import type * as MistralCheck from "@/server/diagnostics/checks/mistral-ocr";
import type * as NotebookLmCheck from "@/server/diagnostics/checks/notebooklm";
import type * as PopplerCheck from "@/server/diagnostics/checks/poppler";

import { CONNECTED_CREDENTIAL, seedArchivableRender, seedArchiveVideo } from "../helpers/archive-fixture";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof DbClient;
let store: typeof CredentialStore;
let drive: typeof DriveCheck;
let mistral: typeof MistralCheck;
let notebooklm: typeof NotebookLmCheck;
let poppler: typeof PopplerCheck;
let overview: typeof DriveOverview;

const MISTRAL = {
  mistral: { apiKey: "sk-secret-value", baseUrl: "https://x", ocrModel: "mistral-ocr-4-1", usdPer1000Pages: 2 },
  ocr: { costCeilingMicroUsd: 3_000_000 },
};

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
  store = await import("@/server/archive/google-drive/drive-credential-store");
  drive = await import("@/server/diagnostics/checks/google-drive");
  mistral = await import("@/server/diagnostics/checks/mistral-ocr");
  notebooklm = await import("@/server/diagnostics/checks/notebooklm");
  poppler = await import("@/server/diagnostics/checks/poppler");
  overview = await import("@/features/drive/services/drive-overview.service");
}, 60_000);

beforeEach(async () => {
  await store.deleteDriveCredential();
  await db.prisma.driveUsageHour.deleteMany();
  await db.prisma.driveCapacity.deleteMany();
});

afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

describe("checkMistralOcr", () => {
  it("says whether a key is set without ever showing it", () => {
    const configured = mistral.checkMistralOcr(MISTRAL);
    expect(configured).toMatchObject({
      status: "ok",
      details: { Model: "mistral-ocr-4-1", "Trần chi phí mỗi sách (USD)": 3 },
    });
    expect(JSON.stringify(configured)).not.toContain("sk-secret-value");

    expect(mistral.checkMistralOcr({ ...MISTRAL, mistral: { ...MISTRAL.mistral, apiKey: undefined } }).status).toBe(
      "info",
    );
  });
});

describe("checkNotebookLm", () => {
  const config = { command: process.execPath, packageSpec: "notebooklm-mcp-cli==0.15.8", profile: "work" };

  it("is ready when the launcher runs and a profile is set", async () => {
    expect(await notebooklm.checkNotebookLm(config)).toMatchObject({ status: "ok", details: { Profile: "work" } });
  });

  it("asks for a profile, then for the launcher, with how to fix each", async () => {
    const noProfile = await notebooklm.checkNotebookLm({ ...config, profile: undefined });
    expect(noProfile).toMatchObject({ status: "warn" });
    expect(noProfile.summary).toContain("nlm login --profile");

    const noLauncher = await notebooklm.checkNotebookLm({ ...config, command: path.join(env.dataDir, "missing-uvx") });
    expect(noLauncher).toMatchObject({ status: "warn" });
    expect(noLauncher.summary).toContain("Cài uv");
  });
});

describe("checkPoppler", () => {
  it("reports the version when the tool runs, and how to install it when it does not", async () => {
    expect(await poppler.checkPoppler(process.execPath)).toMatchObject({ status: "ok", summary: process.version });

    const missing = await poppler.checkPoppler(path.join(env.dataDir, "missing-pdfinfo"));
    expect(missing).toMatchObject({ status: "warn" });
    expect(missing.summary).toContain("sudo apt-get install -y poppler-utils");
  });
});

describe("checkGoogleDrive", () => {
  const configured = { clientId: "client-1" };

  it("goes from not configured, to not connected, to connected, to needing a new sign-in, never showing a token", async () => {
    expect((await drive.checkGoogleDrive({ clientId: undefined })).status).toBe("info");
    expect((await drive.checkGoogleDrive(configured)).summary).toContain("Chưa kết nối");

    await store.writeDriveCredential(CONNECTED_CREDENTIAL);
    const connected = await drive.checkGoogleDrive(configured);
    expect(connected).toMatchObject({ status: "ok", details: { "Tài khoản": "ban@example.com" } });
    expect(JSON.stringify(connected)).not.toContain(CONNECTED_CREDENTIAL.refreshToken);

    await store.writeDriveCredential({ ...CONNECTED_CREDENTIAL, status: "NEEDS_RECONNECT" });
    expect((await drive.checkGoogleDrive(configured)).status).toBe("warn");
  });
});

describe("getDriveOverview", () => {
  it("shows nothing about an account when none is connected", async () => {
    expect(await overview.getDriveOverview()).toMatchObject({
      connection: { connected: false },
      capacity: null,
      failedArchives: 0,
      usage: { requests: 0, bytesSent: 0, maxRequests: 5000, maxBytes: 750 * 1024 ** 3 },
    });
  });

  it("reports the app's use over the last day, the cached storage and failed archives of the connected account", async () => {
    await store.writeDriveCredential(CONNECTED_CREDENTIAL);
    const now = new Date();
    await db.prisma.driveUsageHour.create({
      data: {
        provider: "google-drive",
        hourStart: new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000),
        requests: 12,
        bytesSent: 5000n,
      },
    });
    await db.prisma.driveCapacity.create({
      data: {
        destinationKey: "permission-1",
        limitBytes: 1000n,
        usageBytes: 400n,
        fetchedAt: new Date("2026-10-28T08:00:00.000Z"),
      },
    });

    const videoId = await seedArchiveVideo(db);
    const renderId = await seedArchivableRender(db, env.dataDir, videoId);
    const archives: [string, string][] = [
      ["permission-1", "FAILED"],
      ["permission-2", "FAILED"],
      ["permission-3", "COMPLETED"],
    ];
    for (const [destinationKey, status] of archives) {
      await db.prisma.renderArchive.create({ data: { renderId, provider: "google-drive", destinationKey, status } });
    }

    const result = await overview.getDriveOverview(now);

    expect(result).toMatchObject({
      connection: { connected: true, accountEmail: "ban@example.com" },
      usage: { requests: 12, bytesSent: 5000 },
      capacity: { limitBytes: 1000, usageBytes: 400, fetchedAt: "2026-10-28T08:00:00.000Z" },
      failedArchives: 1,
    });
    expect(JSON.stringify(result)).not.toContain(CONNECTED_CREDENTIAL.refreshToken);
  });
});
