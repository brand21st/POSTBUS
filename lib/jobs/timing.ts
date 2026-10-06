import { logError, logInfo } from "@/lib/logger";

export function queueWaitMs(createdAt?: string | null, now = Date.now()) {
  if (!createdAt) return undefined;
  const started = Date.parse(createdAt);
  if (!Number.isFinite(started)) return undefined;
  return Math.max(0, now - started);
}

export async function timed<T>(
  eventBase: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  logInfo(`${eventBase}.started`, fields);
  try {
    const result = await fn();
    logInfo(`${eventBase}.completed`, {
      ...fields,
      durationMs: Date.now() - started,
      status: "ok",
    });
    return result;
  } catch (error) {
    logError(`${eventBase}.failed`, {
      ...fields,
      durationMs: Date.now() - started,
      status: "failed",
      message: error instanceof Error ? error.message : "failed",
    });
    throw error;
  }
}
