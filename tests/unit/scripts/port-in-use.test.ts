import net from "node:net";

import { describe, expect, it } from "vitest";

import { isPortInUse } from "../../../scripts/lib/port-in-use";

async function listen(host: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return { port: address.port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("isPortInUse", () => {
  it("sees a listening server, and sees it is gone once it closes", async () => {
    const server = await listen("127.0.0.1");

    expect(await isPortInUse(server.port)).toBe(true);

    await server.close();
    expect(await isPortInUse(server.port)).toBe(false);
  });

  it("sees a server listening on every interface", async () => {
    const server = await listen("0.0.0.0");
    try {
      expect(await isPortInUse(server.port)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it.each([0, -1, 65_536, 3000.5, Number.NaN])("treats %s as free, since it is not a usable port", async (port) => {
    expect(await isPortInUse(port)).toBe(false);
  });
});
