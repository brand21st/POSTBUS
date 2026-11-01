import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const SECRET = "public-hmac-secret";
const CLIENT = "public-client";

function signedRequest(
  topic: string,
  shop: string,
  body: string,
  secret = SECRET,
  extra: Record<string, string> = {}
) {
  const hmac = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return new Request("http://localhost:3000/api/shopify/webhooks", {
    method: "POST",
    headers: {
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-webhook-id": extra["x-shopify-webhook-id"] ?? `${topic}-${shop}-1`,
      ...extra,
    },
    body,
  });
}

function adminMock(options?: { installedAt?: string; duplicate?: boolean }) {
  const tables: string[] = [];
  return {
    tables,
    createAdminClient: () => ({
      from: (table: string) => {
        tables.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "install-1",
                    organization_id: "org-1",
                    installed_at: options?.installedAt ?? "2026-10-20T00:00:00.000Z",
                    status: "CONNECTED",
                  },
                }),
              }),
              maybeSingle: async () => ({
                data: options?.duplicate ? { id: "wh-1", status: "SUCCEEDED" } : null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          }),
          upsert: async () => ({ error: null }),
        };
      },
    }),
  };
}

describe("public app webhooks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("rejects invalid HMAC", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const [{ handleShopifyPublicAppWebhook }, { AppError: FreshAppError }] = await Promise.all([
      import("@/lib/shopify-app/webhooks"),
      import("@/lib/api/errors"),
    ]);
    const request = signedRequest("app/uninstalled", "demo.myshopify.com", "{}", "wrong");
    await expect(handleShopifyPublicAppWebhook(request)).rejects.toBeInstanceOf(FreshAppError);
  });

  it("marks the public-app install disconnected without touching BYO connections", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const mock = adminMock();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: mock.createAdminClient,
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const result = await handleShopifyPublicAppWebhook(
      signedRequest("app/uninstalled", "demo.myshopify.com", "{}")
    );
    expect(result).toEqual({ ok: true, topic: "app/uninstalled" });
    expect(mock.tables).toContain("shopify_app_installations");
    expect(mock.tables).not.toContain("shopify_connections");
  });

  it("ignores a stale uninstall after a newer reinstall", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const mock = adminMock({ installedAt: "2026-10-20T12:00:00.000Z" });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: mock.createAdminClient,
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const result = await handleShopifyPublicAppWebhook(
      signedRequest("app/uninstalled", "demo.myshopify.com", "{}", SECRET, {
        "x-shopify-triggered-at": "2026-10-19T00:00:00.000Z",
      })
    );
    expect(result).toMatchObject({ ignored: true, reason: "stale" });
  });

  it("rejects an oversized payload", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const body = "x".repeat(1_048_577);
    await expect(handleShopifyPublicAppWebhook(signedRequest("shop/redact", "demo.myshopify.com", body))).rejects.toMatchObject(
      { code: "VALIDATION_ERROR" }
    );
  });

  it("returns duplicate when the delivery already succeeded", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const mock = adminMock({ duplicate: true });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: mock.createAdminClient,
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const result = await handleShopifyPublicAppWebhook(
      signedRequest("customers/data_request", "demo.myshopify.com", "{}")
    );
    expect(result).toEqual({ duplicate: true, topic: "customers/data_request" });
  });

  it("persists GDPR requests as review-only and never completes deletion", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const upserts: Record<string, unknown>[] = [];
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            upserts.push(row);
            return { error: null };
          },
        }),
      }),
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const result = await handleShopifyPublicAppWebhook(
      signedRequest("shop/redact", "demo.myshopify.com", "{\"shop_id\":1}")
    );
    expect(result).toEqual({ ok: true, topic: "shop/redact" });
    expect(upserts.some((row) => row.status === "PENDING_REVIEW")).toBe(true);
    expect(upserts.some((row) => row.status === "COMPLETED")).toBe(false);
  });

  it("imports an order webhook into the shop's workspace and records the delivery", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const mock = adminMock();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: mock.createAdminClient }));
    const imports: Record<string, unknown>[] = [];
    vi.doMock("@/modules/shopify/orders", () => ({
      importShopifyWebhookOrder: async (_db: unknown, input: Record<string, unknown>) => {
        imports.push(input);
        return { imported: true, updated: false, skipped: false, orderId: "o-1" };
      },
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const body = JSON.stringify({ id: 5551234, name: "#1042" });
    const result = await handleShopifyPublicAppWebhook(signedRequest("orders/create", "demo.myshopify.com", body));
    expect(result).toEqual({ ok: true, topic: "orders/create" });
    expect(imports).toEqual([
      { organizationId: "org-1", shopDomain: "demo.myshopify.com", topic: "orders/create", remote: { id: 5551234, name: "#1042" } },
    ]);
    expect(mock.tables).toContain("shopify_app_webhook_deliveries");
    vi.doUnmock("@/modules/shopify/orders");
  });

  it("does not record a failed order import, so Shopify retries it", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    const upserts: string[] = [];
    const mock = adminMock();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        const client = mock.createAdminClient();
        return {
          from: (table: string) => {
            const builder = client.from(table);
            return {
              ...builder,
              upsert: async () => {
                upserts.push(table);
                return { error: null };
              },
            };
          },
        };
      },
    }));
    vi.doMock("@/modules/shopify/orders", () => ({
      importShopifyWebhookOrder: async () => {
        throw new Error("db down");
      },
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    await expect(
      handleShopifyPublicAppWebhook(signedRequest("orders/updated", "demo.myshopify.com", "{\"id\":1}"))
    ).rejects.toThrow("db down");
    expect(upserts).not.toContain("shopify_app_webhook_deliveries");
    vi.doUnmock("@/modules/shopify/orders");
  });

  it("ignores order webhooks for shops without an installation", async () => {
    vi.resetModules();
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_SECRET", SECRET);
    vi.stubEnv("SHOPIFY_PUBLIC_APP_CLIENT_ID", CLIENT);
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null }) }),
              maybeSingle: async () => ({ data: null }),
            }),
          }),
          upsert: async () => ({ error: null }),
        }),
      }),
    }));
    const { handleShopifyPublicAppWebhook } = await import("@/lib/shopify-app/webhooks");
    const result = await handleShopifyPublicAppWebhook(signedRequest("orders/create", "ghost.myshopify.com", "{\"id\":1}"));
    expect(result).toMatchObject({ ignored: true, reason: "missing_install" });
  });
});

