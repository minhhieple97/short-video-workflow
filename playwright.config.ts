import { defineConfig } from "@playwright/test";

import { E2E_BASE_URL, findRemotionChromium } from "./tests/e2e/stack";

const executablePath = findRemotionChromium();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "vi-VN",
    viewport: { width: 1280, height: 1000 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec tsx tests/e2e/start-stack.ts",
    url: `${E2E_BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
