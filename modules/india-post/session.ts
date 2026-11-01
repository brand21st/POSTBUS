import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingLockUnavailableError } from "@/modules/india-post/booking-lock";
import { indiaPostFromRow } from "@/modules/india-post/provider";
import { indiaPostSessionPersistPatch, type IndiaPostSessionTokens } from "@/modules/india-post/session-tokens";
import { withIndiaPostSessionLock } from "@/modules/india-post/session-lock";

const sessionTails = new Map<string, Promise<void>>();
const CONNECTION_SESSION_COLUMNS =
  "id,organization_id,environment,status,encrypted_username,encrypted_password,encrypted_access_token,encrypted_refresh_token,encrypted_id_token,expires_at,refresh_expires_at,bulk_customer_id,contract_id,pickup_dropoff_office_id";

export async function persistIndiaPostTokens(
  supabase: SupabaseClient,
  connection: { id: string; organization_id?: string | null; sessionLockToken?: string | null },
  tokens: IndiaPostSessionTokens
) {
  let query = supabase.from("india_post_connections").update(indiaPostSessionPersistPatch(tokens)).eq("id", connection.id);
  if (connection.organization_id) {
    query = query.eq("organization_id", connection.organization_id);
  }
  if (connection.sessionLockToken) {
    query = query.eq("session_lock_token", connection.sessionLockToken);
  }
  const selectable = query as typeof query & {
    select?: (columns: string) => { maybeSingle: () => Promise<{ data?: { id?: string } | null; error?: { message?: string } | null }> };
  };
  if (typeof selectable.select === "function") {
    const { data, error } = await selectable.select("id").maybeSingle();
    if (error || !data) {
      throw Object.assign(new Error("Unable to save the India Post session. Please retry."), {
        code: "INTERNAL_ERROR",
      });
    }
    return;
  }
  const result = (await query) as { error?: { message?: string } | null };
  if (result?.error) {
    throw Object.assign(new Error("Unable to save the India Post session. Please retry."), {
      code: "INTERNAL_ERROR",
    });
  }
}

/** In-process queue so concurrent tracking workers do not stampede login for one connection. */
export async function withProcessSessionLock<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
  const prev = sessionTails.get(connectionId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionTails.set(
    connectionId,
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

async function persistSessionFromConnection(
  supabase: SupabaseClient,
  connection: NonNullable<Parameters<typeof indiaPostFromRow>[0]> & {
    id: string;
    organization_id?: string | null;
  },
  sessionLockToken: string
) {
  let row = connection;
  if (typeof supabase.from === "function") {
    type ReloadChain = {
      eq?: (column: string, value: string) => ReloadChain;
      maybeSingle?: () => Promise<{ data?: Record<string, unknown> | null; error?: { message?: string } | null }>;
    };
    let reload = supabase
      .from("india_post_connections")
      .select(CONNECTION_SESSION_COLUMNS)
      .eq("id", connection.id) as unknown as ReloadChain;
    if (connection.organization_id && typeof reload.eq === "function") {
      reload = reload.eq("organization_id", connection.organization_id);
    }
    if (typeof reload.maybeSingle !== "function") {
      throw Object.assign(new Error("Unable to load the India Post session. Please retry."), {
        code: "INTERNAL_ERROR",
      });
    }
    const { data, error } = await reload.maybeSingle();
    if (error) {
      throw Object.assign(new Error("Unable to load the India Post session. Please retry."), {
        code: "INTERNAL_ERROR",
      });
    }
    if (data) row = { ...connection, ...data } as typeof row;
  }
  const provider = indiaPostFromRow(row);
  const session = await provider.ensureSession();
  if (session.tokens && typeof supabase.from === "function") {
    await persistIndiaPostTokens(
      supabase,
      {
        id: row.id,
        organization_id: row.organization_id ?? connection.organization_id,
        sessionLockToken,
      },
      session.tokens
    );
  }
  return provider;
}

async function withLockedPersistedSession(
  supabase: SupabaseClient,
  connection: NonNullable<Parameters<typeof indiaPostFromRow>[0]> & {
    id: string;
    organization_id?: string | null;
  },
  options?: { waitMs?: number }
) {
  const organizationId = String(connection.organization_id ?? "").trim();
  if (!organizationId) {
    throw bookingLockUnavailableError("missing_organization");
  }
  return withProcessSessionLock(connection.id, () =>
    withIndiaPostSessionLock(
      supabase,
      { connectionId: connection.id, organizationId, waitMs: options?.waitMs },
      (lockToken) => persistSessionFromConnection(supabase, connection, lockToken)
    )
  );
}

export async function ensurePersistedIndiaPostSession(
  supabase: SupabaseClient,
  connection: NonNullable<Parameters<typeof indiaPostFromRow>[0]> & {
    id: string;
    organization_id?: string | null;
  },
  options?: { waitMs?: number }
) {
  return withLockedPersistedSession(supabase, connection, options);
}

/** Tracking lookups must not take the India Post booking lock. They use the session lock. */
export async function ensurePersistedIndiaPostTrackingSession(
  supabase: SupabaseClient,
  connection: NonNullable<Parameters<typeof indiaPostFromRow>[0]> & {
    id: string;
    organization_id?: string | null;
  },
  options?: { waitMs?: number }
) {
  return withLockedPersistedSession(supabase, connection, options);
}
