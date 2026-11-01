import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { logInfo } from "@/lib/logger";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Supabase sessions for Shopify installation principals. The projects sign JWTs with asymmetric
 * keys, so the app cannot mint tokens itself: it signs the principal in through Supabase Auth,
 * stores the session encrypted, and refreshes it under a DB lease so instances don't race the
 * rotating refresh token.
 */

const EXPIRY_SKEW_MS = 60_000;
const WAIT_ATTEMPTS = 20;
const WAIT_INTERVAL_MS = 250;

export type PrincipalSessionRow = {
  id: string;
  principal_user_id: string | null;
  encrypted_principal_secret: string | null;
  encrypted_principal_session: string | null;
  principal_session_expires_at: string | null;
  principal_session_version: number;
};

export type PrincipalSession = { accessToken: string; refreshToken: string; expiresAt: string };

export type PrincipalSessionDeps = {
  claimLease: (installationId: string, expectedVersion: number) => Promise<boolean>;
  save: (installationId: string, expectedVersion: number, values: Record<string, unknown>) => Promise<void>;
  reload: (installationId: string) => Promise<PrincipalSessionRow | null>;
  refresh: (refreshToken: string) => Promise<PrincipalSession | null>;
  signIn: (email: string, password: string) => Promise<PrincipalSession>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

const SESSION_COLUMNS =
  "id, principal_user_id, encrypted_principal_secret, encrypted_principal_session, principal_session_expires_at, principal_session_version";

const tokenCache = new Map<string, { accessToken: string; expiresAt: number; version: number }>();

function anonAuthClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured.");
  }
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function toSession(session: { access_token: string; refresh_token: string; expires_at?: number } | null) {
  if (!session?.access_token || !session.refresh_token) return null;
  const expiresAt = session.expires_at ? session.expires_at * 1000 : Date.now() + 3600_000;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function defaultDeps(): PrincipalSessionDeps {
  const admin = createAdminClient();
  return {
    async claimLease(installationId, expectedVersion) {
      const { data, error } = await admin.rpc("claim_shopify_principal_session", {
        p_installation_id: installationId,
        p_expected_version: expectedVersion,
        p_lease_seconds: 15,
      });
      if (error) throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "PostBus is temporarily unavailable.");
      return data === true;
    },
    async save(installationId, expectedVersion, values) {
      const { error } = await admin
        .from("shopify_app_installations")
        .update(values)
        .eq("id", installationId)
        .eq("principal_session_version", expectedVersion);
      if (error) throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "PostBus is temporarily unavailable.");
    },
    async reload(installationId) {
      const { data } = await admin
        .from("shopify_app_installations")
        .select(SESSION_COLUMNS)
        .eq("id", installationId)
        .maybeSingle();
      return (data ?? null) as PrincipalSessionRow | null;
    },
    async refresh(refreshToken) {
      const { data, error } = await anonAuthClient().auth.refreshSession({ refresh_token: refreshToken });
      return error ? null : toSession(data.session);
    },
    async signIn(email, password) {
      const { data, error } = await anonAuthClient().auth.signInWithPassword({ email, password });
      const session = error ? null : toSession(data.session);
      if (!session) throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Could not open the PostBus session.");
      return session;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

function readSession(row: PrincipalSessionRow): PrincipalSession | null {
  if (!row.encrypted_principal_session) return null;
  try {
    return JSON.parse(decryptSecret(row.encrypted_principal_session)) as PrincipalSession;
  } catch {
    return null;
  }
}

function usable(session: PrincipalSession | null, now: number) {
  return Boolean(session && Date.parse(session.expiresAt) - EXPIRY_SKEW_MS > now);
}

async function renew(row: PrincipalSessionRow, deps: PrincipalSessionDeps): Promise<PrincipalSession> {
  const current = readSession(row);
  if (current?.refreshToken) {
    const refreshed = await deps.refresh(current.refreshToken);
    if (refreshed) return refreshed;
  }
  if (!row.encrypted_principal_secret) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "The Shopify app account is not ready.");
  }
  const { email, password } = JSON.parse(decryptSecret(row.encrypted_principal_secret)) as {
    email: string;
    password: string;
  };
  return deps.signIn(email, password);
}

/** Returns a valid access token for the installation principal, renewing it when needed. */
export async function principalAccessToken(
  row: PrincipalSessionRow,
  deps: PrincipalSessionDeps = defaultDeps()
): Promise<string> {
  if (!row.principal_user_id) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "The Shopify app account is not ready.");
  }
  const now = deps.now();
  const cached = tokenCache.get(row.id);
  if (cached && cached.version >= row.principal_session_version && cached.expiresAt - EXPIRY_SKEW_MS > now) {
    return cached.accessToken;
  }

  let latest = row;
  for (let attempt = 0; attempt <= WAIT_ATTEMPTS; attempt += 1) {
    const stored = readSession(latest);
    if (usable(stored, now)) {
      tokenCache.set(row.id, {
        accessToken: stored!.accessToken,
        expiresAt: Date.parse(stored!.expiresAt),
        version: latest.principal_session_version,
      });
      return stored!.accessToken;
    }

    const version = latest.principal_session_version;
    if (await deps.claimLease(row.id, version)) {
      let session: PrincipalSession;
      try {
        session = await renew(latest, deps);
      } catch (error) {
        await deps.save(row.id, version, { principal_session_lease_until: null });
        throw error;
      }
      await deps.save(row.id, version, {
        encrypted_principal_session: encryptSecret(JSON.stringify(session)),
        principal_session_expires_at: session.expiresAt,
        principal_session_version: version + 1,
        principal_session_lease_until: null,
      });
      tokenCache.set(row.id, {
        accessToken: session.accessToken,
        expiresAt: Date.parse(session.expiresAt),
        version: version + 1,
      });
      logInfo("shopify_app.principal_session.renewed", { installationId: row.id });
      return session.accessToken;
    }

    // Another instance holds the lease; wait for it to publish a newer session.
    await deps.sleep(WAIT_INTERVAL_MS);
    latest = (await deps.reload(row.id)) ?? latest;
  }
  throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "PostBus is reconnecting. Try again in a moment.");
}

/** A Supabase client that runs as the principal, so RLS and auth.uid() behave like a dashboard user. */
export function createPrincipalSupabase(accessToken: string): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase public credentials are not configured.");
  }
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function resetPrincipalTokenCacheForTests() {
  tokenCache.clear();
}
