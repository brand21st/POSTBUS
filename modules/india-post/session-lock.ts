import type { SupabaseClient } from "@supabase/supabase-js";
import { logError, logInfo } from "@/lib/logger";
import { lockTokenRef } from "@/modules/india-post/booking-lock";

export const INDIA_POST_SESSION_LOCK_TTL_SECONDS = 25;
export const INDIA_POST_SESSION_LOCK_WAIT_MS = 20_000;
export const INDIA_POST_SESSION_LOCK_RPC_TIMEOUT_MS = 5_000;
const POLL_MS = 150;

export function sessionLockBusyError() {
  return Object.assign(new Error("India Post session lock is busy. Retrying."), {
    code: "TEMPORARY_PROVIDER_FAILURE",
  });
}

export function sessionLockUnavailableError(reason = "rpc_unavailable") {
  return Object.assign(
    new Error(`India Post session lock is unavailable (${reason}). The provider was not called.`),
    { code: "TEMPORARY_PROVIDER_FAILURE" }
  );
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
          reject(Object.assign(new Error("Session lock RPC timed out."), { code: "LOCK_RPC_TIMEOUT" }));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type AcquireResult =
  | { kind: "token"; token: string }
  | { kind: "busy" }
  | { kind: "unavailable"; reason: string };

async function tryAcquireDbLock(supabase: SupabaseClient, connectionId: string): Promise<AcquireResult> {
  if (typeof supabase.rpc !== "function") {
    return { kind: "unavailable", reason: "rpc_missing" };
  }
  try {
    const { data, error } = await withRpcTimeout<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>(
      supabase.rpc("acquire_india_post_session_lock", {
        p_connection_id: connectionId,
        p_ttl_seconds: INDIA_POST_SESSION_LOCK_TTL_SECONDS,
      }) as PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
      INDIA_POST_SESSION_LOCK_RPC_TIMEOUT_MS
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

async function releaseDbLock(supabase: SupabaseClient, connectionId: string, token: string) {
  if (typeof supabase.rpc !== "function") return;
  try {
    const { error } = await withRpcTimeout<{ error: { code?: string; message?: string } | null }>(
      supabase.rpc("release_india_post_session_lock", {
        p_connection_id: connectionId,
        p_token: token,
      }) as PromiseLike<{ error: { code?: string; message?: string } | null }>,
      INDIA_POST_SESSION_LOCK_RPC_TIMEOUT_MS
    );
    if (error && !rpcMissing(error)) {
      logError("india_post.auth.session_lock_release_failed", {
        connectionId,
        tokenRef: lockTokenRef(token),
        message: error.message,
      });
    }
  } catch (error) {
    logError("india_post.auth.session_lock_release_failed", {
      connectionId,
      tokenRef: lockTokenRef(token),
      message: error instanceof Error ? error.message : "release failed",
    });
  }
}

export async function withIndiaPostSessionLock<T>(
  supabase: SupabaseClient,
  input: {
    connectionId: string;
    organizationId?: string;
    waitMs?: number;
  },
  work: (lockToken: string) => Promise<T>
): Promise<T> {
  const started = Date.now();
  const waitMs = input.waitMs ?? INDIA_POST_SESSION_LOCK_WAIT_MS;
  let token: string | null = null;
  while (Date.now() - started < waitMs) {
    const acquired = await tryAcquireDbLock(supabase, input.connectionId);
    if (acquired.kind === "unavailable") {
      logError("india_post.auth.session_lock_unavailable", {
        connectionId: input.connectionId,
        organizationId: input.organizationId,
        reason: acquired.reason,
      });
      throw sessionLockUnavailableError(acquired.reason);
    }
    if (acquired.kind === "token") {
      token = acquired.token;
      break;
    }
    await sleep(POLL_MS);
  }
  if (!token) {
    logError("india_post.auth.session_lock_timeout", {
      connectionId: input.connectionId,
      organizationId: input.organizationId,
      waitMs: Date.now() - started,
    });
    throw sessionLockBusyError();
  }
  logInfo("india_post.auth.session_lock_acquired", {
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    tokenRef: lockTokenRef(token),
  });
  try {
    return await work(token);
  } finally {
    await releaseDbLock(supabase, input.connectionId, token);
    logInfo("india_post.auth.session_lock_released", {
      connectionId: input.connectionId,
      organizationId: input.organizationId,
      tokenRef: lockTokenRef(token),
    });
  }
}
