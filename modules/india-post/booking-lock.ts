import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";

export const INDIA_POST_BOOKING_LOCK_TTL_SECONDS = 45;
export const INDIA_POST_BOOKING_LOCK_WAIT_MS = 40_000;
export const INDIA_POST_BOOKING_LOCK_RPC_TIMEOUT_MS = 5_000;
/** Upper bound the acquire RPC accepts (migration 20261101170000; older databases clamp to 120). */
export const INDIA_POST_BOOKING_LOCK_TTL_MAX_SECONDS = 330;
/** Time inside the lock that is not the POST: per-article intent writes before it, release after it. */
const LOCK_OVERHEAD_MS = 15_000;
const LOCK_INTENT_WRITE_MS_PER_ARTICLE = 40;

/**
 * Lease length for one booking POST. It must outlast the request, or another worker could take
 * the lock while CEPT is still processing. One article keeps the historical 45 s.
 */
export function indiaPostBookingLockTtlSeconds(requestTimeoutMs: number, articleCount = 1) {
  const count = Math.max(1, Math.floor(Number(articleCount) || 1));
  const needed = Math.ceil((requestTimeoutMs + LOCK_OVERHEAD_MS + LOCK_INTENT_WRITE_MS_PER_ARTICLE * count) / 1000);
  return Math.min(INDIA_POST_BOOKING_LOCK_TTL_MAX_SECONDS, Math.max(INDIA_POST_BOOKING_LOCK_TTL_SECONDS, needed));
}
const POLL_MS = 150;

const processTails = new Map<string, Promise<void>>();

export function bookingLockBusyError() {
  return Object.assign(new Error("India Post booking lock is busy. Retrying."), {
    code: "TEMPORARY_PROVIDER_FAILURE",
  });
}

/** DB lease could not be established. Never fall back to process-only locking. */
export function bookingLockUnavailableError(reason = "rpc_unavailable") {
  return Object.assign(
    new Error(`India Post booking lock is unavailable (${reason}). The provider was not called.`),
    { code: "TEMPORARY_PROVIDER_FAILURE" }
  );
}

export function lockTokenRef(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rpcMissing(error: { code?: string; message?: string } | null) {
  const message = String(error?.message ?? "");
  return error?.code === "42883" || /does not exist|could not find the function/i.test(message);
}

async function withRpcTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("Booking lock RPC timed out."), { code: "LOCK_RPC_TIMEOUT" }));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** In-process queue so one Node process does not stampede the DB lease. Not a safety boundary. */
export async function withProcessBookingLock<T>(organizationId: string, work: () => Promise<T>): Promise<T> {
  const prev = processTails.get(organizationId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  processTails.set(
    organizationId,
    prev.then(
      () => held,
      () => held
    )
  );
  await prev.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

type AcquireResult =
  | { kind: "token"; token: string }
  | { kind: "busy" }
  | { kind: "unavailable"; reason: string };

async function tryAcquireDbLock(
  supabase: SupabaseClient,
  organizationId: string,
  ttlSeconds = INDIA_POST_BOOKING_LOCK_TTL_SECONDS
): Promise<AcquireResult> {
  if (typeof supabase.rpc !== "function") {
    return { kind: "unavailable", reason: "rpc_missing" };
  }
  try {
    const { data, error } = await withRpcTimeout<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>(
      supabase.rpc("acquire_india_post_booking_lock", {
        p_organization_id: organizationId,
        p_ttl_seconds: ttlSeconds,
      }) as PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
      INDIA_POST_BOOKING_LOCK_RPC_TIMEOUT_MS
    );
    if (error) {
      if (rpcMissing(error)) return { kind: "unavailable", reason: "rpc_missing" };
      return { kind: "unavailable", reason: error.message || "rpc_error" };
    }
    if (data == null || data === "") return { kind: "busy" };
    if (typeof data !== "string") return { kind: "unavailable", reason: "rpc_malformed" };
    return { kind: "token", token: data };
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    const message = error instanceof Error ? error.message : "rpc_error";
    if (code === "LOCK_RPC_TIMEOUT") return { kind: "unavailable", reason: "rpc_timeout" };
    if (rpcMissing(error as { code?: string; message?: string })) return { kind: "unavailable", reason: "rpc_missing" };
    return { kind: "unavailable", reason: message };
  }
}

async function releaseDbLock(supabase: SupabaseClient, organizationId: string, token: string) {
  if (typeof supabase.rpc !== "function") return;
  try {
    const { error } = await withRpcTimeout<{ error: { code?: string; message?: string } | null }>(
      supabase.rpc("release_india_post_booking_lock", {
        p_organization_id: organizationId,
        p_token: token,
      }) as PromiseLike<{ error: { code?: string; message?: string } | null }>,
      INDIA_POST_BOOKING_LOCK_RPC_TIMEOUT_MS
    );
    if (error && !rpcMissing(error)) {
      logError("booking.lock_release_failed", {
        organizationId,
        tokenRef: lockTokenRef(token),
        message: error.message,
      });
    }
  } catch (error) {
    logError("booking.lock_release_failed", {
      organizationId,
      tokenRef: lockTokenRef(token),
      message: error instanceof Error ? error.message : "release failed",
    });
  }
}

export async function withIndiaPostBookingLock<T>(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    jobId?: string;
    shipmentId?: string;
    connectionId?: string;
    waitMs?: number;
    /** Lease length; see indiaPostBookingLockTtlSeconds. Defaults to 45 s. */
    ttlSeconds?: number;
    skipProcessLock?: boolean;
  },
  work: () => Promise<T>
): Promise<T> {
  const run = async () => {
    const started = Date.now();
    const waitMs = input.waitMs ?? INDIA_POST_BOOKING_LOCK_WAIT_MS;
    let token: string | null = null;
    while (Date.now() - started < waitMs) {
      const acquired = await tryAcquireDbLock(supabase, input.organizationId, input.ttlSeconds);
      if (acquired.kind === "unavailable") {
        logError("booking.lock_unavailable", {
          organizationId: input.organizationId,
          jobId: input.jobId,
          shipmentId: input.shipmentId,
          connectionId: input.connectionId,
          lock_unavailable: true,
          reason: acquired.reason,
        });
        throw bookingLockUnavailableError(acquired.reason);
      }
      if (acquired.kind === "token") {
        token = acquired.token;
        break;
      }
      await sleep(POLL_MS);
    }
    if (!token) {
      logError("booking.lock_timeout", {
        organizationId: input.organizationId,
        jobId: input.jobId,
        shipmentId: input.shipmentId,
        connectionId: input.connectionId,
        waitMs: Date.now() - started,
      });
      throw bookingLockBusyError();
    }
    logInfo("booking.lock_acquired", {
      organizationId: input.organizationId,
      jobId: input.jobId,
      shipmentId: input.shipmentId,
      connectionId: input.connectionId,
      lock_acquired: true,
      waitMs: Date.now() - started,
      dbLock: true,
      tokenRef: lockTokenRef(token),
    });
    try {
      return await work();
    } finally {
      await releaseDbLock(supabase, input.organizationId, token);
      logInfo("booking.lock_released", {
        organizationId: input.organizationId,
        jobId: input.jobId,
        shipmentId: input.shipmentId,
        connectionId: input.connectionId,
        lock_released: true,
        holdMs: Date.now() - started,
        tokenRef: lockTokenRef(token),
      });
    }
  };
  if (input.skipProcessLock) return run();
  return withProcessBookingLock(input.organizationId, run);
}
