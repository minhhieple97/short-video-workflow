import { prisma } from "@/server/db/client";

export interface NewOAuthAuthorization {
  provider: string;
  stateHash: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
}

export async function createOAuthAuthorization(authorization: NewOAuthAuthorization): Promise<void> {
  await prisma.oAuthAuthorization.create({ data: authorization });
}

// Rows are only useful until they expire or are used; nothing else reads them afterwards.
export async function purgeSpentOAuthAuthorizations(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.oAuthAuthorization.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
  });
  return count;
}

export type ConsumedOAuthAuthorization =
  { status: "consumed"; codeVerifier: string; redirectUri: string } | { status: "unknown" | "expired" | "used" };

// A state works once, before it expires. The conditional update is the first statement, so two callbacks with the same
// state cannot both get the verifier.
export function consumeOAuthAuthorization(
  provider: string,
  stateHash: string,
  now: Date = new Date(),
): Promise<ConsumedOAuthAuthorization> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.oAuthAuthorization.updateMany({
      where: { provider, stateHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    const row = await tx.oAuthAuthorization.findFirst({ where: { provider, stateHash } });
    if (!row) return { status: "unknown" };
    if (count === 1) return { status: "consumed", codeVerifier: row.codeVerifier, redirectUri: row.redirectUri };
    return { status: row.consumedAt ? "used" : "expired" };
  });
}
