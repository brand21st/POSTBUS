import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { logError, logInfo } from "@/lib/logger";
import { decryptSecret } from "@/lib/security/crypto";
import { loadShopifyAppInstallation, type ShopifyAppInstallationRow } from "@/lib/shopify-app/provision";
import {
  encryptTokenSet,
  exchangeIdTokenForOfflineAccess,
  isRejectedShopifyGrant,
  refreshOfflineAccessToken,
  tokenNeedsRefresh,
  withShopRefreshLock,
  type ShopifyOfflineTokenSet,
} from "@/lib/shopify-app/token-exchange";
import { createAdminClient } from "@/lib/supabase/admin";

const LEASE_SECONDS = 30;
const WAIT_ATTEMPTS = 20;
const WAIT_INTERVAL_MS = 250;

type InstallationUpdate = Record<string, unknown>;

export type OfflineTokenDeps = {
  claimLease: (installationId: string, expectedVersion: number) => Promise<boolean>;
  /** Applies the update only while token_version still equals expectedVersion. */
  updateInstallation: (installationId: string, expectedVersion: number, values: InstallationUpdate) => Promise<void>;
  reload: (shopDomain: string) => Promise<ShopifyAppInstallationRow | null>;
  exchange: (shopDomain: string, idToken: string) => Promise<ShopifyOfflineTokenSet>;
  refresh: (shopDomain: string, refreshToken: string) => Promise<ShopifyOfflineTokenSet>;
  sleep: (ms: number) => Promise<void>;
};

function defaultDeps(): OfflineTokenDeps {
  const admin = createAdminClient();
  return {
    async claimLease(installationId, expectedVersion) {
      const { data, error } = await admin.rpc("claim_shopify_token_refresh", {
        p_installation_id: installationId,
        p_expected_version: expectedVersion,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (error) {
        throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify connection is temporarily unavailable.");
      }
      return data === true;
    },
    async updateInstallation(installationId, expectedVersion, values) {
      const { error } = await admin
        .from("shopify_app_installations")
        .update(values)
        .eq("id", installationId)
        .eq("token_version", expectedVersion);
      if (error) {
        throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Could not save the Shopify connection.");
      }
    },
    reload: loadShopifyAppInstallation,
    exchange: exchangeIdTokenForOfflineAccess,
    refresh: refreshOfflineAccessToken,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function adopt(target: ShopifyAppInstallationRow, source: ShopifyAppInstallationRow) {
  Object.assign(target, source);
}

async function waitForOtherRefresh(
  installation: ShopifyAppInstallationRow,
  version: number,
  deps: OfflineTokenDeps
) {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    await deps.sleep(WAIT_INTERVAL_MS);
    const latest = await deps.reload(installation.shop_domain);
    if (latest && (latest.token_version ?? 0) > version) {
      adopt(installation, latest);
      return;
    }
  }
  throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify is reconnecting. Try again in a moment.");
}

/**
 * Makes sure the installation holds a usable offline token. Only one process refreshes at a time
 * (DB lease + token_version compare-and-swap); the others wait for the winner's result.
 */
export async function ensureOfflineToken(
  installation: ShopifyAppInstallationRow,
  idToken: string | null,
  shopDomain: string,
  deps: OfflineTokenDeps = defaultDeps()
) {
  // REAUTH_REQUIRED heals itself: a fresh session token is all a token exchange needs.
  const needsExchange = !installation.encrypted_access_token || installation.status === "REAUTH_REQUIRED";
  const needsRefresh = !needsExchange && tokenNeedsRefresh(installation.token_expires_at);
  if (!needsExchange && !needsRefresh) return;
  // Background jobs have no session token; only the merchant reopening the app can exchange.
  if (needsExchange && !idToken) return;

  await withShopRefreshLock(shopDomain, async () => {
    const version = installation.token_version ?? 0;
    if (!(await deps.claimLease(installation.id, version))) {
      await waitForOtherRefresh(installation, version, deps);
      return;
    }

    let tokens: ShopifyOfflineTokenSet;
    try {
      tokens = await obtainTokens(installation, idToken, shopDomain, needsRefresh, deps);
    } catch (error) {
      if (isRejectedShopifyGrant(error)) {
        await deps.updateInstallation(installation.id, version, {
          status: "REAUTH_REQUIRED",
          last_error: "Shopify refused the offline token grant.",
          token_refresh_lease_until: null,
        });
        installation.status = "REAUTH_REQUIRED";
        logError("shopify_app.token.rejected", { shopDomain, installationId: installation.id });
        return;
      }
      // Transient (network, 5xx, 429): keep the current status and let the caller retry.
      await deps.updateInstallation(installation.id, version, { token_refresh_lease_until: null });
      throw error instanceof AppError
        ? error
        : new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify is temporarily unavailable. Try again.");
    }

    const encrypted = encryptTokenSet(tokens);
    await deps.updateInstallation(installation.id, version, {
      ...encrypted,
      status: "CONNECTED",
      last_error: null,
      token_version: version + 1,
      token_refresh_lease_until: null,
    });
    Object.assign(installation, encrypted, { status: "CONNECTED", token_version: version + 1 });
    logInfo("shopify_app.token.stored", {
      shopDomain,
      installationId: installation.id,
      mode: needsRefresh ? "refresh" : "exchange",
    });
    if (needsExchange && installation.organization_id) {
      const { scheduleSheetsCrmEvent } = await import("@/modules/sheets-crm/enqueue");
      scheduleSheetsCrmEvent({
        eventType: "store.connected",
        organizationId: installation.organization_id,
      });
    }
  });
}

async function obtainTokens(
  installation: ShopifyAppInstallationRow,
  idToken: string | null,
  shopDomain: string,
  needsRefresh: boolean,
  deps: OfflineTokenDeps
) {
  if (needsRefresh && installation.encrypted_refresh_token) {
    try {
      return await deps.refresh(shopDomain, decryptSecret(installation.encrypted_refresh_token));
    } catch (error) {
      // A refused refresh token is recoverable while we hold a valid session token.
      if (!isRejectedShopifyGrant(error) || !idToken) throw error;
    }
  }
  if (!idToken) {
    throw new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "Shopify needs the merchant to reopen the app.");
  }
  return deps.exchange(shopDomain, idToken);
}
