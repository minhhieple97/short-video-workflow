import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as NotebookStudio from "@/features/notebooklm/services/notebook-studio.service";
import type * as Ocr from "@/server/ocr";
import type * as Env from "@/shared/config/env";

import { E2E_ENV } from "../e2e/stack";
import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let config: typeof Env;
let ocr: typeof Ocr;
let notebook: typeof NotebookStudio;

beforeAll(async () => {
  // As if the developer's shell held real credentials.
  Object.assign(process.env, {
    MISTRAL_API_KEY: "real-looking-key",
    GOOGLE_OAUTH_CLIENT_ID: "real-client.apps.googleusercontent.com",
    NOTEBOOKLM_PROFILE: "personal",
    AI_MODE: "cli-auto",
  });
  env = setupTestEnvironment();
  config = await import("@/shared/config/env");
  ocr = await import("@/server/ocr");
  notebook = await import("@/features/notebooklm/services/notebook-studio.service");
}, 60_000);

afterAll(() => env.cleanup());

describe("the test environment", () => {
  it("switches every paid or personal integration off, whatever the shell holds", () => {
    const app = config.getAppConfig();

    expect(app.ai.mode).toBe("mock");
    expect(app.mistral.apiKey).toBeUndefined();
    expect(new URL(app.mistral.baseUrl).hostname).toBe("127.0.0.1");
    expect(app.drive.clientId).toBeUndefined();
    expect(app.notebookLm.profile).toBeUndefined();
    expect(() => ocr.createOcrProvider()).toThrow(expect.objectContaining({ code: "OCR_NOT_CONFIGURED" }));
    expect(notebook.notebookStudioSettings()).toBeNull();
  });

  it("does the same for the end-to-end stack, whose processes would otherwise read .env", () => {
    expect(E2E_ENV).toMatchObject({
      AI_MODE: "mock",
      MISTRAL_API_KEY: "",
      GOOGLE_OAUTH_CLIENT_ID: "",
      NOTEBOOKLM_PROFILE: "",
    });
  });
});
