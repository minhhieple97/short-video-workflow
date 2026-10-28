import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { Redis } from "ioredis";

import { FakeGoogleServer } from "../helpers/fake-google-server";
import { E2E_DATA_DIR, E2E_ENV, E2E_PORT } from "./stack";

fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(E2E_DATA_DIR, { recursive: true });

// A fake Google (token + Drive APIs) lives in this process for the whole run, and the app starts already connected to
// it, so finished FINAL renders are archived without any real account.
const google = new FakeGoogleServer();
await google.start();
const E2E_REFRESH_TOKEN = "e2e-refresh-token";
google.liveRefreshTokens.add(E2E_REFRESH_TOKEN);
const credentialFile = path.join(E2E_DATA_DIR, "credentials", "google-drive.json");
fs.mkdirSync(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
fs.writeFileSync(
  credentialFile,
  JSON.stringify({
    status: "CONNECTED",
    refreshToken: E2E_REFRESH_TOKEN,
    scope: google.grantedScope,
    accessToken: null,
    accessTokenExpiresAt: null,
    accountId: google.account.permissionId,
    accountEmail: google.account.emailAddress,
    connectedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);

const env = {
  ...process.env,
  ...E2E_ENV,
  GOOGLE_API_BASE_URL: google.endpoints.tokenUrl.replace(/\/token$/, ""),
  GOOGLE_OAUTH_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "e2e-secret",
  // Writes a real, short MP3 per scene, so batch production can voice its videos offline.
  EDGE_TTS_COMMAND: path.join(import.meta.dirname, "../helpers/fake-edge-tts-audio.mjs"),
  POPPLER_BIN_DIR: process.env.TEST_POPPLER_BIN_DIR ?? "",
};

execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "inherit" });

const redis = new Redis(E2E_ENV.REDIS_URL ?? "", { maxRetriesPerRequest: 1 });
await redis.flushdb();
redis.disconnect();

const children: ChildProcess[] = [
  spawn("pnpm", ["worker:start"], { env, stdio: "inherit" }),
  spawn("pnpm", ["exec", "next", "start", "-H", "127.0.0.1", "-p", String(E2E_PORT)], { env, stdio: "inherit" }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  void google.stop();
  setTimeout(() => process.exit(0), 3_000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const child of children) child.on("exit", (code) => code && code !== 0 && stop());
