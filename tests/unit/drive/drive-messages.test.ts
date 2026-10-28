import { describe, expect, it } from "vitest";

import { driveCallbackError } from "@/features/drive/domain/drive-messages";

describe("driveCallbackError", () => {
  it("explains the errors a Google sign-in can end with", () => {
    expect(driveCallbackError("DRIVE_ACCESS_DENIED")).toBe("Bạn đã không cấp quyền Google Drive cho ứng dụng.");
    expect(driveCallbackError("GOOGLE_INVALID_CLIENT")).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(driveCallbackError("DRIVE_OAUTH_STATE_EXPIRED")).toContain("10 phút");
  });

  it("falls back to a general message for a code it does not know, without echoing it", () => {
    expect(driveCallbackError("<script>")).toBe("Kết nối Google Drive không thành công. Hãy thử lại.");
  });
});
