import "dotenv/config";

import { prisma } from "@/server/db/client";
import { getDiagnosticsSnapshot } from "@/server/diagnostics/get-diagnostics-snapshot";
import type { CheckStatus } from "@/server/diagnostics/types";

const ICONS: Record<CheckStatus, string> = { ok: "[ OK ]", warn: "[WARN]", error: "[FAIL]", info: "[INFO]" };

async function main(): Promise<number> {
  const snapshot = await getDiagnosticsSnapshot();
  console.log(`${snapshot.app.name} v${snapshot.app.version}\n`);
  for (const check of snapshot.checks) {
    console.log(`${ICONS[check.status]} ${check.label}: ${check.summary}`);
    for (const [key, value] of Object.entries(check.details ?? {})) console.log(`         ${key}: ${String(value)}`);
  }
  console.log("\nCấu hình:");
  for (const row of snapshot.config) console.log(`  ${row.label}: ${row.value}`);
  return snapshot.overall === "ok" ? 0 : 1;
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
