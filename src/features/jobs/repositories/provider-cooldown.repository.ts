import { prisma } from "@/server/db/client";

export function findProviderCooldown(provider: string) {
  return prisma.providerCooldown.findUnique({ where: { provider } });
}

export function listProviderCooldowns(now = new Date()) {
  return prisma.providerCooldown.findMany({ where: { blockedUntil: { gt: now } }, orderBy: { provider: "asc" } });
}

export async function saveProviderCooldown(input: {
  provider: string;
  blockedUntil: Date;
  errorCode: string;
  message: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.providerCooldown.findUnique({ where: { provider: input.provider } });
    if (existing && existing.blockedUntil > input.blockedUntil) return;
    await tx.providerCooldown.upsert({ where: { provider: input.provider }, create: input, update: input });
  });
}

export async function clearProviderCooldown(provider: string): Promise<void> {
  await prisma.providerCooldown.deleteMany({ where: { provider } });
}
