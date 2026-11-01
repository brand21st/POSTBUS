import { describe, expect, it, vi } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { encryptSecret } from "@/lib/security/crypto";
import { ensureOfflineToken, type OfflineTokenDeps } from "@/lib/shopify-app/offline-token";
import type { ShopifyAppInstallationRow } from "@/lib/shopify-app/provision";

const SHOP = "demo.myshopify.com";
const freshTokens = {
  accessToken: "shpua_new",
  refreshToken: "shpur_new",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  refreshExpiresAt: null,
  scope: "read_orders",
};

function installation(overrides: Partial<ShopifyAppInstallationRow> = {}): ShopifyAppInstallationRow {
  return {
    id: "inst-1",
    shop_domain: SHOP,
    organization_id: "org-1",
    app_client_id: "client",
    status: "CONNECTED",
    encrypted_access_token: encryptSecret("shpua_old"),
    encrypted_refresh_token: encryptSecret("shpur_old"),
    token_expires_at: new Date(Date.now() + 5_000).toISOString(),
    refresh_token_expires_at: null,
    granted_scopes: "read_orders",
    last_shopify_user_id: null,
    uninstalled_at: null,
    token_version: 3,
    ...overrides,
  };
}

function deps(overrides: Partial<OfflineTokenDeps> = {}): OfflineTokenDeps {
  return {
    claimLease: vi.fn(async () => true),
    updateInstallation: vi.fn(async () => undefined),
    reload: vi.fn(async () => null),
    exchange: vi.fn(async () => freshTokens),
    refresh: vi.fn(async () => freshTokens),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

const rejected = () => new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "refused", { status: 400 });
const outage = () => new AppError(ERROR_CODES.AUTH_UNAVAILABLE, "down", { status: 503 });

describe("ensureOfflineToken", () => {
  it("does nothing while the token is fresh", async () => {
    const d = deps();
    await ensureOfflineToken(installation({ token_expires_at: new Date(Date.now() + 3600_000).toISOString() }), "id", SHOP, d);
    expect(d.claimLease).not.toHaveBeenCalled();
  });

  it("refreshes under the lease and bumps token_version with compare-and-swap", async () => {
    const d = deps();
    const row = installation();
    await ensureOfflineToken(row, "id", SHOP, d);
    expect(d.claimLease).toHaveBeenCalledWith("inst-1", 3);
    expect(d.refresh).toHaveBeenCalledWith(SHOP, "shpur_old");
    expect(d.updateInstallation).toHaveBeenCalledWith(
      "inst-1",
      3,
      expect.objectContaining({ status: "CONNECTED", token_version: 4, token_refresh_lease_until: null })
    );
    expect(row.token_version).toBe(4);
  });

  it("waits for the lease holder instead of burning the rotated refresh token", async () => {
    const winner = installation({ token_version: 4, status: "CONNECTED" });
    const d = deps({
      claimLease: vi.fn(async () => false),
      reload: vi.fn().mockResolvedValueOnce(installation()).mockResolvedValueOnce(winner),
    });
    const row = installation();
    await ensureOfflineToken(row, "id", SHOP, d);
    expect(d.refresh).not.toHaveBeenCalled();
    expect(row.token_version).toBe(4);
  });

  it("gives up with a retryable error when the lease holder never finishes", async () => {
    const d = deps({ claimLease: vi.fn(async () => false), reload: vi.fn(async () => installation()) });
    await expect(ensureOfflineToken(installation(), "id", SHOP, d)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_UNAVAILABLE,
    });
  });

  it("falls back to token exchange when Shopify refuses the refresh token", async () => {
    const d = deps({ refresh: vi.fn(async () => { throw rejected(); }) });
    const row = installation();
    await ensureOfflineToken(row, "session-token", SHOP, d);
    expect(d.exchange).toHaveBeenCalledWith(SHOP, "session-token");
    expect(row.status).toBe("CONNECTED");
  });

  it("marks REAUTH_REQUIRED only when both grants are refused", async () => {
    const d = deps({
      refresh: vi.fn(async () => { throw rejected(); }),
      exchange: vi.fn(async () => { throw rejected(); }),
    });
    const row = installation();
    await ensureOfflineToken(row, "id", SHOP, d);
    expect(row.status).toBe("REAUTH_REQUIRED");
    expect(d.updateInstallation).toHaveBeenCalledWith("inst-1", 3, expect.objectContaining({ status: "REAUTH_REQUIRED" }));
  });

  it("keeps the status and releases the lease on a transient Shopify outage", async () => {
    const d = deps({ refresh: vi.fn(async () => { throw outage(); }) });
    const row = installation();
    await expect(ensureOfflineToken(row, "id", SHOP, d)).rejects.toBeInstanceOf(AppError);
    expect(row.status).toBe("CONNECTED");
    expect(d.exchange).not.toHaveBeenCalled();
    expect(d.updateInstallation).toHaveBeenCalledWith("inst-1", 3, { token_refresh_lease_until: null });
  });

  it("recovers a REAUTH_REQUIRED install with a fresh session token", async () => {
    const d = deps();
    const row = installation({ status: "REAUTH_REQUIRED", token_expires_at: null });
    await ensureOfflineToken(row, "session-token", SHOP, d);
    expect(d.exchange).toHaveBeenCalledWith(SHOP, "session-token");
    expect(row.status).toBe("CONNECTED");
  });

  it("background jobs never attempt a token exchange without a session token", async () => {
    const d = deps();
    const row = installation({ status: "REAUTH_REQUIRED", token_expires_at: null });
    await ensureOfflineToken(row, null, SHOP, d);
    expect(d.claimLease).not.toHaveBeenCalled();
    expect(row.status).toBe("REAUTH_REQUIRED");
  });

  it("background refresh that Shopify refuses marks REAUTH_REQUIRED instead of exchanging", async () => {
    const d = deps({
      refresh: vi.fn(async () => {
        throw rejected();
      }),
    });
    const row = installation();
    await ensureOfflineToken(row, null, SHOP, d);
    expect(d.exchange).not.toHaveBeenCalled();
    expect(row.status).toBe("REAUTH_REQUIRED");
  });
});

