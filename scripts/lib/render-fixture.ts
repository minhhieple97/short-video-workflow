import fs from "node:fs/promises";
import path from "node:path";

import {
  shortVideoPropsSchema,
  toCompositionProps,
  type ShortVideoProps,
} from "@/features/videos/domain/composition-props";
import {
  renderSnapshotSchema,
  toCompositionSource,
  type RenderSnapshot,
} from "@/features/videos/domain/render-snapshot";
import { startAssetServer, type AssetServer, type ServedAsset } from "@/server/render/asset-server";
import { dataPath } from "@/server/storage/paths";

// A fixture is a render snapshot plus the narration files it names, kept under DATA_DIR/fixtures/<name>/ (book text and
// audio are user data, so fixtures are never committed). Benchmarks and stills render it through the same props mapping as
// the worker, so a fixture captured before a template change shows what today's code makes of the same input.
export interface RenderFixture {
  name: string;
  snapshot: RenderSnapshot;
}

export function fixtureDir(name: string): string {
  if (!/^[\w-]+$/.test(name)) throw new Error(`Invalid fixture name "${name}"`);
  return dataPath("fixtures", name);
}

export function fixtureAudioFile(name: string, storedPath: string): string {
  return path.join(fixtureDir(name), "audio", path.basename(storedPath));
}

export async function loadRenderFixture(name: string): Promise<RenderFixture> {
  const raw: unknown = JSON.parse(await fs.readFile(path.join(fixtureDir(name), "snapshot.json"), "utf8"));
  return { name, snapshot: renderSnapshotSchema.parse(raw) };
}

export async function serveFixtureAudio(fixture: RenderFixture): Promise<AssetServer> {
  const served = new Map<string, ServedAsset>();
  for (const audio of fixture.snapshot.audio) {
    served.set(audio.assetId, { absolutePath: fixtureAudioFile(fixture.name, audio.path), mimeType: audio.mimeType });
  }
  return startAssetServer(served);
}

export function fixtureProps(fixture: RenderFixture, server: AssetServer): ShortVideoProps {
  return shortVideoPropsSchema.parse(toCompositionProps(toCompositionSource(fixture.snapshot), server.urlFor));
}
