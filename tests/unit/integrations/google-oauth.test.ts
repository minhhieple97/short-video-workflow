import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  DRIVE_FILE_SCOPE,
  hashOAuthState,
  loopbackRedirectUri,
} from "@/server/archive/google-drive/google-oauth";

describe("createPkcePair", () => {
  it("makes a verifier Google accepts and the S256 challenge for it", () => {
    const { verifier, challenge } = createPkcePair();

    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(challenge).not.toContain("=");
  });

  it("never repeats a verifier or a state", () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => createPkcePair().verifier));
    const states = new Set(Array.from({ length: 50 }, () => createOAuthState()));

    expect(verifiers.size).toBe(50);
    expect(states.size).toBe(50);
    expect(createOAuthState().length).toBeGreaterThanOrEqual(43);
  });

  it("stores a state only as its hash", () => {
    const state = createOAuthState();

    expect(hashOAuthState(state)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOAuthState(state)).not.toContain(state);
    expect(hashOAuthState(state)).toBe(hashOAuthState(state));
  });
});

describe("buildAuthorizationUrl", () => {
  it("asks Google for drive.file only, with PKCE S256 and the state, and no secret", () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: "client-1.apps.googleusercontent.com",
        redirectUri: "http://127.0.0.1:3000",
        state: "state-1",
        codeChallenge: "challenge-1",
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1.apps.googleusercontent.com",
      redirect_uri: "http://127.0.0.1:3000",
      response_type: "code",
      scope: DRIVE_FILE_SCOPE,
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
    });
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });
});

describe("loopbackRedirectUri", () => {
  it.each([
    ["http://127.0.0.1:3000/api/integrations/drive/connect", "http://127.0.0.1:3000"],
    ["http://localhost:3100/x", "http://127.0.0.1:3100"],
    ["http://[::1]:4000/", "http://127.0.0.1:4000"],
    ["http://127.0.0.1/", "http://127.0.0.1:80"],
  ])("sends Google back to the loopback address for %s", (requestUrl, expected) => {
    expect(loopbackRedirectUri(requestUrl)).toBe(expected);
  });

  it.each(["http://192.168.1.20:3000/", "http://studio.example.com/", "https://127.0.0.1:3000/"])(
    "refuses a request that did not come in on the loopback address: %s",
    (requestUrl) => {
      expect(() => loopbackRedirectUri(requestUrl)).toThrow(
        expect.objectContaining({ code: "DRIVE_REDIRECT_NOT_LOOPBACK" }),
      );
    },
  );
});
