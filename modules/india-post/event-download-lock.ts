import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { lockTokenRef } from "@/modules/india-post/booking-lock";
import {
  INDIA_POST_EVENT_DOWNLOAD_LEASE_TTL_SECONDS,
  INDIA_POST_EVENT_DOWNLOAD_LEASE_WAIT_MS,
} from "@/modules/india-post/spec";

const inflight = new Map<string, Promise<unknown>>();
const POLL_MS = 150;
const RPC_TIMEOUT_MS = 5_000;

export type EventDownloadLeaseScope = {
  organizationId: string;
  custId: string;
  eventCode?: string;
  eventDate: string;
};

export function eventDownloadLockKey(customerId: string, eventDates: string[]) {
  return `${customerId}:${eventDates.join(",")}`;
}

export function eventDownloadLeaseIdentity(scope: EventDownloadLeaseScope) {
  return {
    organizationId: scope.organizationId,
    custId: scope.custId,
    eventCode: (scope.eventCode || "LE").toUpperCase(),
    eventDate: scope.eventDate,
  };
}

/** Concurrent public/dashboard/NDR refreshes share one Event Download for the same customer and dates. */
export function withEventDownloadLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

export function resetEventDownloadLocks() {
  inflight.clear();
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
          reject(Object.assign(new Error("Event download lease RPC timed out."), { code: "LOCK_RPC_TIMEOUT" }));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type AcquireResult = { kind: "token"; token: string } | { kind: "busy" } | { kind: "unavailable"; reason: string };

async function tryAcquire(
  supabase: SupabaseClient,
  scope: ReturnType<typeof eventDownloadLeaseIdentity>,
  ttlSeconds: number
): Promise<AcquireResult> {
  if (typeof supabase.rpc !== "function") {
    return { kind: "unavailable", reason: "rpc_missing" };
  }
  try {
    const { data, error } = await withRpcTimeout<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>(
      supabase.rpc("acquire_tracking_event_download_lock", {
        p_organization_id: scope.organizationId,
        p_cust_id: scope.custId,
        p_event_code: scope.eventCode,
        p_event_date: scope.eventDate,
        p_ttl_seconds: ttlSeconds,
      }) as PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
      RPC_TIMEOUT_MS
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
    if (code === "LOCK_RPC_TIMEOUT") return { kind: "unavailable", reason: "rpc_timeout" };
    if (rpcMissing(error as { code?: string; message?: string })) return { kind: "unavailable", reason: "rpc_missing" };
    return { kind: "unavailable", reason: error instanceof Error ? error.message : "rpc_error" };
  }
}

async function releaseLease(
  supabase: SupabaseClient,
  scope: ReturnType<typeof eventDownloadLeaseIdentity>,
  token: string
) {
  if (typeof supabase.rpc !== "function") return;
  try {
    const { error } = await withRpcTimeout<{ error: { code?: string; message?: string } | null }>(
      supabase.rpc("release_tracking_event_download_lock", {
        p_organization_id: scope.organizationId,
        p_cust_id: scope.custId,
        p_event_code: scope.eventCode,
        p_event_date: scope.eventDate,
        p_token: token,
      }) as PromiseLike<{ error: { code?: string; message?: string } | null }>,
      RPC_TIMEOUT_MS
    );
    if (error && !rpcMissing(error)) {
      logError("india_post.event_download.lease_release_failed", {
        organizationId: scope.organizationId,
        eventDate: scope.eventDate,
        tokenRef: lockTokenRef(token),
        message: error.message,
      });
    }
  } catch (error) {
    logError("india_post.event_download.lease_release_failed", {
      organizationId: scope.organizationId,
      eventDate: scope.eventDate,
      tokenRef: lockTokenRef(token),
      message: error instanceof Error ? error.message : "release failed",
    });
  }
}

/**
 * Acquire steal-on-expiry Postgres leases for Event Download dates.
 * HTTP work runs after the acquire transaction completes.
 * Busy dates are waited, then skipped so another worker can reuse checkpoints.
 */
export async function withEventDownloadLeases<T>(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    custId: string;
    eventCode?: string;
    eventDates: string[];
    waitMs?: number;
    ttlSeconds?: number;
    allowMissingRpc?: boolean;
  },
  work: (heldDates: string[]) => Promise<T>
): Promise<T> {
  const dates = [...new Set(input.eventDates.filter((value) => /^\d{8}$/.test(value)))];
  if (!dates.length) return work([]);

  const waitMs = input.waitMs ?? INDIA_POST_EVENT_DOWNLOAD_LEASE_WAIT_MS;
  const ttlSeconds = input.ttlSeconds ?? INDIA_POST_EVENT_DOWNLOAD_LEASE_TTL_SECONDS;
  const held: Array<{ date: string; token: string; scope: ReturnType<typeof eventDownloadLeaseIdentity> }> = [];
  const pending = [...dates];
  const started = Date.now();

  while (pending.length && Date.now() - started < waitMs) {
    const remaining: string[] = [];
    for (const eventDate of pending) {
      const scope = eventDownloadLeaseIdentity({
        organizationId: input.organizationId,
        custId: input.custId,
        eventCode: input.eventCode,
        eventDate,
      });
      const acquired = await tryAcquire(supabase, scope, ttlSeconds);
      if (acquired.kind === "unavailable") {
        if (input.allowMissingRpc && acquired.reason === "rpc_missing") {
          return work(dates);
        }
        throw Object.assign(
          new Error(`India Post event download lease is unavailable (${acquired.reason}).`),
          { code: "TEMPORARY_PROVIDER_FAILURE" }
        );
      }
      if (acquired.kind === "token") {
        held.push({ date: eventDate, token: acquired.token, scope });
        continue;
      }
      remaining.push(eventDate);
    }
    pending.length = 0;
    pending.push(...remaining);
    if (pending.length) await sleep(POLL_MS);
  }

  const heldDates = held.map((row) => row.date);
  if (pending.length) {
    logInfo("india_post.event_download.lease_skipped", {
      organizationId: input.organizationId,
      skippedDates: pending,
      heldDates,
    });
  }

  try {
    return await work(heldDates);
  } finally {
    for (const row of held) {
      await releaseLease(supabase, row.scope, row.token);
    }
  }
}
