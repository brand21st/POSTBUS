import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/security/crypto";
import { bookingLockUnavailableError, withIndiaPostBookingLock } from "@/modules/india-post/booking-lock";
import { indiaPostFromRow } from "@/modules/india-post/provider";

const sessionTails = new Map<string, Promise<void>>();

export async function persistIndiaPostTokens(
  supabase: SupabaseClient,
  connection: { id: string },
  tokens: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    refresh_expires_in?: number;
  }
) {
  await supabase
    .from("india_post_connections")
    .update({
      encrypted_access_token: encryptSecret(tokens.access_token),
      encrypted_refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      encrypted_id_token: tokens.id_token ? encryptSecret(tokens.id_token) : null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at:
        tokens.refresh_expires_in != null
          ? new Date(Date.now() + tokens.refresh_expires_in * 1000).toISOString()
          : null,
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
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

export const INDIA_POST_TRACKING_SESSION_LOCK_WAIT_MS = 200;

export async function ensurePersistedIndiaPostSession(
  supabase: SupabaseClient,
  connection: NonNullable<Parameters<typeof indiaPostFromRow>[0]> & {
    id: string;
    organization_id?: string | null;
  }
) {
  const organizationId = String(connection.organization_id ?? "").trim();
  if (!organizationId) {
    throw bookingLockUnavailableError("missing_organization");
  }
  return withProcessSessionLock(connection.id, () =>
    withIndiaPostBookingLock(
      supabase,
      {
        organizationId,
        connectionId: connection.id,
        skipProcessLock: true,
        waitMs: INDIA_POST_TRACKING_SESSION_LOCK_WAIT_MS,
      },
      async () => {
        const provider = indiaPostFromRow(connection);
        const session = await provider.ensureSession();
        if (session.tokens) {
          await persistIndiaPostTokens(supabase, connection, session.tokens);
        }
        return provider;
      }
    )
  );
}
