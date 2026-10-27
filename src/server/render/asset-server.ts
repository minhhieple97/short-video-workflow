import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ServedAsset {
  absolutePath: string;
  mimeType: string;
}

export interface AssetServer {
  urlFor: (assetId: string) => string | null;
  close: () => Promise<void>;
}

// Headless Chromium can only fetch audio over HTTP, so a render gets a short-lived localhost server
// that serves exactly the assets of that video and nothing else.
export async function startAssetServer(assets: ReadonlyMap<string, ServedAsset>): Promise<AssetServer> {
  const server = http.createServer((request, response) => {
    const id = /^\/assets\/([\w-]+)$/.exec(request.url ?? "")?.[1];
    const asset = id ? assets.get(id) : undefined;
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    fs.stat(asset.absolutePath).then(
      (stats) => {
        response.writeHead(200, { "Content-Type": asset.mimeType, "Content-Length": stats.size });
        createReadStream(asset.absolutePath).pipe(response);
      },
      () => response.writeHead(404).end(),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    urlFor: (assetId) => (assets.has(assetId) ? `http://127.0.0.1:${port}/assets/${assetId}` : null),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
