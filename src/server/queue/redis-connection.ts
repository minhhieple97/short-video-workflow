import { Redis } from "ioredis";

import { getAppConfig } from "@/shared/config/env";

export function redactRedisUrl(redisUrl: string): string {
  const { protocol, hostname, port } = new URL(redisUrl);
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
}

// Producers (web) fail fast so API routes answer quickly when Redis is down.
export function createProducerConnection(): Redis {
  const connection = new Redis(getAppConfig().redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 3_000 });
  connection.on("error", () => undefined);
  return connection;
}

// BullMQ workers require unlimited per-request retries (maxRetriesPerRequest: null).
export function createWorkerConnection(): Redis {
  return new Redis(getAppConfig().redisUrl, { maxRetriesPerRequest: null });
}

// Short-lived connection for health probes: connects once, never reconnects, errors surface via the rejected promise.
export async function withProbeConnection<T>(run: (connection: Redis) => Promise<T>): Promise<T> {
  const connection = new Redis(getAppConfig().redisUrl, {
    lazyConnect: true,
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  connection.on("error", () => undefined);
  try {
    await connection.connect();
    return await run(connection);
  } finally {
    connection.disconnect();
  }
}
