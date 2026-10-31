import { prisma } from "@/server/db/client";

import type { ConcurrencySettings } from "../domain/concurrency-settings";

export function listConcurrencySettingRows(): Promise<{ key: string; value: number }[]> {
  return prisma.concurrencySetting.findMany({ select: { key: true, value: true } });
}

export async function saveConcurrencySettings(settings: ConcurrencySettings): Promise<void> {
  await prisma.$transaction(
    Object.entries(settings).map(([key, value]) =>
      prisma.concurrencySetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
  );
}
