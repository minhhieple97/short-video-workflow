import http from "node:http";

import { describe, expect, it } from "vitest";

import { findPortHolder, isProjectWeb, parseSsOwner } from "../../../scripts/lib/port-holder";

async function serve(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return { port: address.port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("parseSsOwner", () => {
  it("reads the pid of the owner from ss output", () => {
    expect(parseSsOwner('LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=535507,fd=42))')).toEqual({
      pid: 535507,
    });
    expect(parseSsOwner("LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*")).toBeNull();
    expect(parseSsOwner("")).toBeNull();
  });
});

describe("findPortHolder", () => {
  it("finds this very process as the holder of a port it listens on", async () => {
    const server = await serve((_, response) => response.end("ok"));
    try {
      const holder = await findPortHolder(server.port);
      // Where `ss` is missing the answer is "unknown", which is also acceptable; where it works it must be right.
      if (holder) {
        expect(holder.pid).toBe(process.pid);
        expect(holder.command.length).toBeGreaterThan(0);
      }
    } finally {
      await server.close();
    }
  });

  it("finds nobody on a port nothing listens on", async () => {
    const server = await serve((_, response) => response.end());
    const { port } = server;
    await server.close();
    expect(await findPortHolder(port)).toBeNull();
  });
});

describe("isProjectWeb", () => {
  it("recognises the project's /api/status answer", async () => {
    const server = await serve((_, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ worker: "running", activeJobs: 0, aiMode: "mock" }));
    });
    try {
      expect(await isProjectWeb(server.port)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("does not take another server for it", async () => {
    const server = await serve((_, response) => response.end("<html>other app</html>"));
    try {
      expect(await isProjectWeb(server.port)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("says no when nothing answers", async () => {
    const server = await serve((_, response) => response.end());
    const { port } = server;
    await server.close();
    expect(await isProjectWeb(port)).toBe(false);
  });
});
