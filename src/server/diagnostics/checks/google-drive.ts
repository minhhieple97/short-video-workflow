import { readDriveCredential } from "@/server/archive/google-drive/drive-credential-store";
import { getAppConfig, type AppConfig } from "@/shared/config/env";

import type { CheckResult } from "../types";

// Tokens are never shown; only whether a connection exists and for which account.
export async function checkGoogleDrive(
  drive: Pick<AppConfig["drive"], "clientId"> = getAppConfig().drive,
): Promise<CheckResult> {
  if (!drive.clientId) {
    return {
      id: "google-drive",
      label: "Google Drive",
      status: "info",
      summary: "Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID; video chỉ được lưu local.",
    };
  }
  const credential = await readDriveCredential();
  if (!credential) {
    return {
      id: "google-drive",
      label: "Google Drive",
      status: "info",
      summary: "Chưa kết nối. Kết nối trong mục Tích hợp.",
    };
  }
  if (credential.status === "NEEDS_RECONNECT") {
    return {
      id: "google-drive",
      label: "Google Drive",
      status: "warn",
      summary: "Google không còn chấp nhận quyền truy cập; hãy kết nối lại. Việc lưu Drive đang dừng.",
      details: { "Tài khoản": credential.accountEmail ?? "(không rõ email)" },
    };
  }
  return {
    id: "google-drive",
    label: "Google Drive",
    status: "ok",
    summary: "Đã kết nối (quyền drive.file).",
    details: { "Tài khoản": credential.accountEmail ?? "(không rõ email)" },
  };
}
