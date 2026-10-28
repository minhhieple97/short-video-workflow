import { describe, expect, it } from "vitest";

import { GOOGLE_ENDPOINTS, googleEndpoints } from "@/server/archive/google-drive/google-http";

describe("googleEndpoints", () => {
  it("is Google itself unless a base URL is configured", () => {
    expect(googleEndpoints(undefined)).toBe(GOOGLE_ENDPOINTS);
    expect(GOOGLE_ENDPOINTS.tokenUrl).toBe("https://oauth2.googleapis.com/token");
  });

  it("serves every Google path from one local base URL for a fake", () => {
    expect(googleEndpoints("http://127.0.0.1:4010")).toEqual({
      tokenUrl: "http://127.0.0.1:4010/token",
      revokeUrl: "http://127.0.0.1:4010/revoke",
      driveApiUrl: "http://127.0.0.1:4010/drive/v3",
      driveUploadUrl: "http://127.0.0.1:4010/upload/drive/v3",
    });
  });
});
