import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { renderSnapshotSchema } from "@/features/videos/domain/render-snapshot";
import { prisma } from "@/server/db/client";
import { writeFileAtomic } from "@/server/storage/atomic-write";
import { resolveWithinRoot } from "@/server/storage/safe-path";

import { fixtureAudioFile, fixtureDir } from "./lib/render-fixture";

// Copies one render's snapshot and narration into DATA_DIR/fixtures/<name>/. The database is the one DATABASE_URL names and
// --from is its data folder, so a fixture can be taken from another checkout's data:
//   DATABASE_URL=file:/path/to/data/studio.db pnpm fixture:export --render <id> --name <name> --from /path/to/data
const { values } = parseArgs({
  options: { render: { type: "string" }, name: { type: "string" }, from: { type: "string" } },
  strict: true,
});

async function main(): Promise<number> {
  if (!values.render || !values.name || !values.from) {
    console.error("Usage: pnpm fixture:export --render <renderId> --name <fixture> --from <source DATA_DIR>");
    return 2;
  }
  const record = await prisma.renderRecord.findUnique({ where: { id: values.render } });
  if (!record?.snapshotJson) {
    console.error(`Render ${values.render} not found or has no snapshot.`);
    return 1;
  }
  const snapshot = renderSnapshotSchema.parse(record.snapshotJson);
  const sourceRoot = path.resolve(values.from);
  await fs.mkdir(path.join(fixtureDir(values.name), "audio"), { recursive: true });
  for (const audio of snapshot.audio) {
    await fs.copyFile(resolveWithinRoot(sourceRoot, audio.path), fixtureAudioFile(values.name, audio.path));
  }
  await writeFileAtomic(path.join(fixtureDir(values.name), "snapshot.json"), JSON.stringify(snapshot, null, 2));
  const visible = snapshot.scenes.filter((scene) => !scene.hidden).length;
  console.log(
    `Fixture "${values.name}": ${visible} scenes, ${snapshot.audio.length} audio files → ${fixtureDir(values.name)}`,
  );
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
