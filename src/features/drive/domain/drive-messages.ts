// What the user reads after Google sends them back to the app (the callback puts the outcome in the settings URL).
const CALLBACK_ERRORS: Record<string, string> = {
  DRIVE_OAUTH_STATE_INVALID: "Phiên kết nối không hợp lệ. Hãy bấm kết nối lại.",
  DRIVE_OAUTH_STATE_EXPIRED: "Phiên kết nối đã quá 10 phút. Hãy bấm kết nối lại.",
  DRIVE_OAUTH_STATE_USED: "Phiên kết nối này đã được dùng. Nếu Drive chưa kết nối, hãy bấm kết nối lại.",
  DRIVE_ACCESS_DENIED: "Bạn đã không cấp quyền Google Drive cho ứng dụng.",
  DRIVE_SCOPE_NOT_GRANTED: "Google chưa cấp quyền lưu tệp lên Drive. Hãy kết nối lại và đánh dấu quyền đó.",
  DRIVE_NO_REFRESH_TOKEN: "Google không trả refresh token. Hãy kết nối lại.",
  DRIVE_NOT_CONFIGURED: "Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID.",
  GOOGLE_INVALID_CLIENT:
    "Google không nhận OAuth client này. Hãy kiểm tra GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET.",
  GOOGLE_INVALID_GRANT: "Mã cấp quyền đã hết hạn hoặc đã dùng. Hãy kết nối lại.",
};

export function driveCallbackError(code: string): string {
  return CALLBACK_ERRORS[code] ?? "Kết nối Google Drive không thành công. Hãy thử lại.";
}
