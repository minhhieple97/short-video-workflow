import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyGoogleFailure, sendGoogleRequest } from "@/server/archive/google-drive/google-http";

let server: http.Server;
let baseUrl = "";
let next: { status: number; body: string; headers?: Record<string, string>; delayMs?: number } = {
  status: 200,
  body: "{}",
};

beforeAll(async () => {
  server = http.createServer((_request, response) => {
    const answer = next;
    setTimeout(() => {
      response.writeHead(answer.status, { "content-type": "application/json", ...answer.headers });
      response.end(answer.body);
    }, answer.delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const send = (mutating = false) =>
  sendGoogleRequest({
    url: `${baseUrl}/x`,
    method: "GET",
    mutating,
    timeoutMs: 5_000,
    parse: async (response) => (await response.json()) as unknown,
  });

describe("classifyGoogleFailure", () => {
  it.each([
    [400, "invalid_grant", false, "AUTH"],
    [401, "invalid_client", false, "AUTH"],
    [401, null, false, "AUTH"],
    [403, "insufficientPermissions", false, "AUTH"],
    [403, "userRateLimitExceeded", false, "QUOTA"],
    [403, "rateLimitExceeded", true, "QUOTA"],
    [429, null, false, "QUOTA"],
    [500, null, false, "TRANSIENT"],
    [503, null, true, "UNKNOWN_OUTCOME"],
    [408, null, false, "TRANSIENT"],
    [400, "badRequest", false, "REJECTED"],
    [404, "notFound", true, "REJECTED"],
  ] as const)("status %i with reason %s (mutating %s) is %s", (status, reason, mutating, kind) => {
    expect(classifyGoogleFailure(status, reason, mutating)).toBe(kind);
  });
});

describe("sendGoogleRequest", () => {
  it("names the error after Google's reason and keeps the rest of the body out of it", async () => {
    next = {
      status: 400,
      body: JSON.stringify({ error: "invalid_grant", error_description: "secret-looking 1//refresh-token" }),
    };

    const error = await send().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "GOOGLE_INVALID_GRANT", kind: "AUTH", details: { status: 400 } });
    expect(JSON.stringify(error)).not.toContain("1//refresh-token");
    expect((error as Error).message).not.toContain("1//refresh-token");
  });

  it("tells the user to check the client configuration when Google does not know the client", async () => {
    next = { status: 401, body: JSON.stringify({ error: "invalid_client" }) };

    const error = await send().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "GOOGLE_INVALID_CLIENT", kind: "AUTH" });
    expect((error as Error).message).toContain("GOOGLE_OAUTH_CLIENT_ID");
  });

  it("reads a Drive error's reason and passes on the pause Google asks for", async () => {
    next = {
      status: 403,
      body: JSON.stringify({ error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } }),
      headers: { "retry-after": "7" },
    };

    await expect(send()).rejects.toMatchObject({
      code: "GOOGLE_USERRATELIMITEXCEEDED",
      kind: "QUOTA",
      retryAfterMs: 7_000,
    });
  });

  it("ignores a reason that is not a plain identifier", async () => {
    next = { status: 400, body: JSON.stringify({ error: "<script>alert(1)</script>" }) };

    await expect(send()).rejects.toMatchObject({ code: "GOOGLE_HTTP_400", kind: "REJECTED" });
  });

  it("reports an unparseable answer to a mutating call as an unknown outcome", async () => {
    next = { status: 200, body: "not json" };

    await expect(send(true)).rejects.toMatchObject({ code: "GOOGLE_BAD_RESPONSE", kind: "UNKNOWN_OUTCOME" });
    await expect(send(false)).rejects.toMatchObject({ code: "GOOGLE_BAD_RESPONSE", kind: "REJECTED" });
  });

  it("reports an unreachable Google as temporary, or unknown for a mutating call", async () => {
    const unreachable = (mutating: boolean) =>
      sendGoogleRequest({
        url: "http://127.0.0.1:9/x",
        method: "POST",
        mutating,
        timeoutMs: 2_000,
        parse: async () => null,
      });

    await expect(unreachable(false)).rejects.toMatchObject({ code: "GOOGLE_TRANSPORT", kind: "TRANSIENT" });
    await expect(unreachable(true)).rejects.toMatchObject({ code: "GOOGLE_TRANSPORT", kind: "UNKNOWN_OUTCOME" });
  });

  it("lets a cancellation during the request through untouched", async () => {
    next = { status: 200, body: "{}", delayMs: 500 };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(
      sendGoogleRequest({
        url: `${baseUrl}/x`,
        method: "GET",
        mutating: true,
        timeoutMs: 5_000,
        signal: controller.signal,
        parse: async () => null,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("lets a cancellation through untouched and sends nothing once aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      sendGoogleRequest({
        url: `${baseUrl}/x`,
        method: "GET",
        mutating: false,
        timeoutMs: 1_000,
        signal: controller.signal,
        parse: async () => null,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
