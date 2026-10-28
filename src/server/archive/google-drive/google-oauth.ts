import { createHash, randomBytes } from "node:crypto";

import { AppError } from "@/shared/errors";

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
// The only permission asked for: files this app creates (or the user opens with it), nothing else in their Drive.
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// RFC 7636: 43–128 characters from the unreserved set; base64url of 48 random bytes is 64 such characters.
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

// Google's documented loopback form for desktop clients is http://127.0.0.1:<port> with no path, so Google sends the browser
// back to the app's root. The app only listens on 127.0.0.1, so a request that reached it from anywhere else is refused.
export function loopbackRedirectUri(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AppError(
      "DRIVE_REDIRECT_NOT_LOOPBACK",
      "Chỉ kết nối Google Drive được khi mở ứng dụng tại http://127.0.0.1 trên chính máy này.",
      400,
    );
  }
  return `http://127.0.0.1:${url.port || "80"}`;
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: DRIVE_FILE_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
