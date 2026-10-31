import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type * as Db from "@/server/db/client";

import { setupTestEnvironment, type TestEnvironment } from "../helpers/test-environment";

let env: TestEnvironment;
let db: typeof Db;

beforeAll(async () => {
  env = setupTestEnvironment();
  db = await import("@/server/db/client");
}, 60_000);
beforeEach(async () => {
  await db.prisma.providerCooldown.deleteMany();
});
afterAll(async () => {
  await db.prisma.$disconnect();
  env.cleanup();
});

const cooldown = (provider: string) => ({
  provider,
  blockedUntil: new Date(Date.now() + 60_000),
  errorCode: "TEST",
  message: "test",
  kind: "TRANSIENT",
});

// The worker runs several jobs at once on the process's one SQLite connection: a write of one job must never become part of
// another job's open transaction.
describe("one SQLite connection shared by concurrent jobs", () => {
  it("keeps a write made outside a transaction when that transaction rolls back", async () => {
    let releaseTransaction: () => void = () => undefined;
    const transactionMayFinish = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let transactionStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      transactionStarted = resolve;
    });

    const rolledBack = db.prisma
      .$transaction(async (tx) => {
        await tx.providerCooldown.create({ data: cooldown("inside") });
        transactionStarted();
        await transactionMayFinish;
        throw new Error("roll back");
      })
      .catch((error: unknown) => error);

    await started;
    // A Prisma query runs only once something waits on it; `then` starts it now, while the transaction is open.
    const outside = db.prisma.providerCooldown.create({ data: cooldown("outside") }).then((row) => row);
    // Give the outside write every chance to run while the transaction is still open.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseTransaction();

    expect(await rolledBack).toMatchObject({ message: "roll back" });
    await outside;
    const providers = (await db.prisma.providerCooldown.findMany()).map((row) => row.provider);
    expect(providers).toEqual(["outside"]);
  });

  it("does not let a read outside a transaction see that transaction's uncommitted write", async () => {
    let releaseTransaction: () => void = () => undefined;
    const transactionMayFinish = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let transactionStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      transactionStarted = resolve;
    });

    const rolledBack = db.prisma
      .$transaction(async (tx) => {
        await tx.providerCooldown.create({ data: cooldown("never-committed") });
        transactionStarted();
        await transactionMayFinish;
        throw new Error("roll back");
      })
      .catch((error: unknown) => error);

    await started;
    const read = db.prisma.providerCooldown.count().then((count) => count);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseTransaction();
    expect(await rolledBack).toMatchObject({ message: "roll back" });
    expect(await read).toBe(0);
  });
});
