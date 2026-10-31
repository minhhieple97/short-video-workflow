import type { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { Mutex } from "@/shared/mutex";

type SqlDriverAdapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;
type Transaction = Awaited<ReturnType<SqlDriverAdapter["startTransaction"]>>;
type AdapterFactory = Pick<PrismaBetterSqlite3, "provider" | "adapterName" | "connect" | "connectToShadowDb">;

// The better-sqlite3 adapter has one connection per process and orders only transactions among themselves. A query made
// outside a transaction while another task's transaction is open ran on that same connection, inside it: it read the
// uncommitted rows and was lost when that transaction rolled back. Here every query and every transaction take turns on
// one lock, held by a transaction from its start until Prisma commits or rolls it back.
export function serializeAdapterFactory(factory: PrismaBetterSqlite3): AdapterFactory {
  return {
    provider: factory.provider,
    adapterName: factory.adapterName,
    connect: async () => serializeAdapter(await factory.connect()),
    connectToShadowDb: async () => serializeAdapter(await factory.connectToShadowDb()),
  };
}

function serializeAdapter(adapter: SqlDriverAdapter): SqlDriverAdapter {
  const lock = new Mutex();
  const serialized: SqlDriverAdapter = {
    provider: adapter.provider,
    adapterName: adapter.adapterName,
    queryRaw: (query) => lock.run(() => adapter.queryRaw(query)),
    executeRaw: (query) => lock.run(() => adapter.executeRaw(query)),
    executeScript: (script) => lock.run(() => adapter.executeScript(script)),
    startTransaction: async (isolationLevel) => {
      const release = await lock.acquire();
      try {
        return holdUntilFinished(await adapter.startTransaction(isolationLevel), release);
      } catch (error) {
        release();
        throw error;
      }
    },
    dispose: () => adapter.dispose(),
  };
  if (adapter.getConnectionInfo) serialized.getConnectionInfo = adapter.getConnectionInfo.bind(adapter);
  return serialized;
}

function holdUntilFinished(transaction: Transaction, release: () => void): Transaction {
  const finish = async (end: () => Promise<void>) => {
    try {
      await end();
    } finally {
      release();
    }
  };
  const held: Transaction = {
    provider: transaction.provider,
    adapterName: transaction.adapterName,
    options: transaction.options,
    queryRaw: (query) => transaction.queryRaw(query),
    executeRaw: (query) => transaction.executeRaw(query),
    commit: () => finish(() => transaction.commit()),
    rollback: () => finish(() => transaction.rollback()),
  };
  if (transaction.createSavepoint) held.createSavepoint = transaction.createSavepoint.bind(transaction);
  if (transaction.rollbackToSavepoint) held.rollbackToSavepoint = transaction.rollbackToSavepoint.bind(transaction);
  if (transaction.releaseSavepoint) held.releaseSavepoint = transaction.releaseSavepoint.bind(transaction);
  return held;
}
