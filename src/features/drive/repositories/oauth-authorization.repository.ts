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
