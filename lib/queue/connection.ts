import IORedis from "ioredis";
import { env } from "@/lib/env";

let connection: IORedis | null = null;

export function getRedis() {
  if (!connection) {
    connection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      retryStrategy(times) {
        if (times > 2) return null;
        return 200;
      },
    });
    connection.on("error", () => {
      // Connection errors are surfaced by enqueue/health callers.
    });
  }
  return connection;
}

export async function redisHealth() {
  try {
    const result = await getRedis().ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
