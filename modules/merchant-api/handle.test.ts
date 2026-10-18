import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  ctx: {
    apiKeyId: "key-a",
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationName: "Alpha",
    accountStatus: "ACTIVE",
    scopes: ["orders:read"],
    keyPrefix: "pb_live_abc",
    createdBy: "user-a",
  },
}));

const mocks = vi.hoisted(() => ({
  getMerchantOrder: vi.fn(),
  createMerchantOrder: vi.fn(),
  listMerchantOrders: vi.fn(),
  patchMerchantOrder: vi.fn(),
  bookMerchantOrder: vi.fn(),
  getMerchantShipment: vi.fn(),
  getMerchantLabel: vi.fn(),
  consume: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => true,
  createAdminClient: () => ({ from: () => ({ insert: async () => ({}) }) }),
}));

vi.mock("@/modules/merchant-api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/merchant-api/auth")>("@/modules/merchant-api/auth");
  return {
    ...actual,
    authenticateMerchantApiKey: async () => auth.ctx,
  };
});

vi.mock("@/modules/merchant-api/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/modules/merchant-api/rate-limit")>(
    "@/modules/merchant-api/rate-limit"
  );
  return {
    ...actual,
    consumeMerchantRate: (...args: unknown[]) => mocks.consume(...args),
    assertPayloadSize: () => undefined,
  };
});

vi.mock("@/modules/merchant-api/idempotency", async () => {
  const actual = await vi.importActual<typeof import("@/modules/merchant-api/idempotency")>(
    "@/modules/merchant-api/idempotency"
  );
  return {
    ...actual,
    beginIdempotency: (...args: unknown[]) => mocks.begin(...args),
    completeIdempotency: (...args: unknown[]) => mocks.complete(...args),
    failIdempotency: (...args: unknown[]) => mocks.fail(...args),
  };
});

vi.mock("@/modules/merchant-api/orders", () => ({
  createMerchantOrder: (...args: unknown[]) => mocks.createMerchantOrder(...args),
  getMerchantOrder: (...args: unknown[]) => mocks.getMerchantOrder(...args),
  listMerchantOrders: (...args: unknown[]) => mocks.listMerchantOrders(...args),
  patchMerchantOrder: (...args: unknown[]) => mocks.patchMerchantOrder(...args),
  merchantActor: () => ({}),
}));

vi.mock("@/modules/merchant-api/shipments", () => ({
  bookMerchantOrder: (...args: unknown[]) => mocks.bookMerchantOrder(...args),
  getMerchantShipment: (...args: unknown[]) => mocks.getMerchantShipment(...args),
  listMerchantShipments: vi.fn(),
  getMerchantTracking: vi.fn(),
  getMerchantLabel: (...args: unknown[]) => mocks.getMerchantLabel(...args),
}));

vi.mock("@/modules/merchant-api/logs", () => ({
  writeMerchantApiLog: (...args: unknown[]) => mocks.log(...args),
}));

import { handleMerchantV1 } from "@/modules/merchant-api/handle";

function req(method: string, url: string, init?: RequestInit) {
  return new NextRequest(url, { method, ...init });
}

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("handleMerchantV1", () => {
  afterEach(() => {
    delete process.env.MERCHANT_API_ENABLED;
    delete process.env.MERCHANT_API_ORG_ALLOWLIST;
  });

  beforeEach(() => {
    process.env.MERCHANT_API_ENABLED = "true";
    process.env.MERCHANT_API_ORG_ALLOWLIST = `${ORG_A},${ORG_B}`;
    auth.ctx.scopes = ["orders:read"];
    auth.ctx.organizationId = ORG_A;
    mocks.consume.mockResolvedValue({ remaining: 10, limit: 120 });
    mocks.begin.mockResolvedValue({ replay: null });
    mocks.getMerchantOrder.mockReset();
    mocks.createMerchantOrder.mockReset();
    mocks.bookMerchantOrder.mockReset();
    mocks.getMerchantLabel.mockReset();
  });

  it("returns identity without secrets", async () => {
    const response = await handleMerchantV1(req("GET", "http://localhost/api/merchant/v1/me"), ["me"]);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.api_key.prefix).toBe("pb_live_abc");
    expect(JSON.stringify(json)).not.toContain("pb_live_abc_");
  });

  it("rejects authenticated keys for orgs off the allowlist", async () => {
    process.env.MERCHANT_API_ORG_ALLOWLIST = ORG_B;
    const response = await handleMerchantV1(req("GET", "http://localhost/api/merchant/v1/me"), ["me"]);
    const json = await response.json();
    expect(response.status).toBe(403);
    expect(json.error.code).toBe("MERCHANT_API_DISABLED");
  });

  it("denies order create without orders:write", async () => {
    const response = await handleMerchantV1(
      req("POST", "http://localhost/api/merchant/v1/orders", {
        headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
        body: "{}",
      }),
      ["orders"]
    );
    const json = await response.json();
    expect(response.status).toBe(403);
    expect(json.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("does not let org A read an order from another tenant (service filters org)", async () => {
    mocks.getMerchantOrder.mockImplementation(async (_db, ctx: { organizationId: string }, id: string) => {
      if (ctx.organizationId !== ORG_A || id !== "11111111-1111-4111-8111-111111111111") {
        const { MerchantApiError, MERCHANT_ERROR_CODES } = await import("@/modules/merchant-api/errors");
        throw new MerchantApiError(MERCHANT_ERROR_CODES.RESOURCE_NOT_FOUND, "Order not found.");
      }
      return { id, organization_check: ctx.organizationId };
    });
    auth.ctx.organizationId = ORG_B;
    const response = await handleMerchantV1(
      req("GET", "http://localhost/api/merchant/v1/orders/11111111-1111-4111-8111-111111111111"),
      ["orders", "11111111-1111-4111-8111-111111111111"]
    );
    const json = await response.json();
    expect(response.status).toBe(404);
    expect(json.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("rejects booking without shipments:book even when orders:write is present", async () => {
    auth.ctx.scopes = ["orders:write"];
    const response = await handleMerchantV1(
      req("POST", "http://localhost/api/merchant/v1/orders/11111111-1111-4111-8111-111111111111/book", {
        headers: { "Idempotency-Key": "book-1", "Content-Type": "application/json" },
        body: "{}",
      }),
      ["orders", "11111111-1111-4111-8111-111111111111", "book"]
    );
    expect((await response.json()).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("replays matching idempotency without creating again", async () => {
    auth.ctx.scopes = ["orders:write"];
    mocks.begin.mockResolvedValue({ replay: { order: { id: "ord-1" } } });
    const response = await handleMerchantV1(
      req("POST", "http://localhost/api/merchant/v1/orders", {
        headers: { "Idempotency-Key": "same", "Content-Type": "application/json" },
        body: JSON.stringify({ customer: { name: "A", phone: "9876543210" } }),
      }),
      ["orders"]
    );
    expect(mocks.createMerchantOrder).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.data.id).toBe("ord-1");
  });

  it("returns conflict when idempotency payload differs", async () => {
    auth.ctx.scopes = ["orders:write"];
    mocks.begin.mockRejectedValue(
      new (await import("@/modules/merchant-api/errors")).MerchantApiError(
        "IDEMPOTENCY_CONFLICT",
        "This Idempotency-Key was already used with a different request body."
      )
    );
    const response = await handleMerchantV1(
      req("POST", "http://localhost/api/merchant/v1/orders", {
        headers: { "Idempotency-Key": "same", "Content-Type": "application/json" },
        body: "{}",
      }),
      ["orders"]
    );
    expect((await response.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("returns per-row bulk errors without dropping successes", async () => {
    auth.ctx.scopes = ["orders:write"];
    const { MerchantApiError, MERCHANT_ERROR_CODES } = await import("@/modules/merchant-api/errors");
    mocks.createMerchantOrder
      .mockResolvedValueOnce({ duplicate: false, order: { id: "ok-1" } })
      .mockRejectedValueOnce(new MerchantApiError(MERCHANT_ERROR_CODES.VALIDATION_ERROR, "Invalid pincode"));
    const response = await handleMerchantV1(
      req("POST", "http://localhost/api/merchant/v1/orders/bulk", {
        headers: { "Idempotency-Key": "bulk-1", "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: [
            {
              customer: { name: "Ravi Kumar", phone: "9876543210" },
              shipping_address: { line1: "12 MG Road", city: "Bengaluru", state: "KA", pincode: "560001" },
              line_items: [{ title: "A", quantity: 1 }],
            },
            {
              customer: { name: "Anita", phone: "9876543210" },
              shipping_address: { line1: "12 MG Road", city: "Bengaluru", state: "KA", pincode: "560001" },
              line_items: [{ title: "B", quantity: 1 }],
            },
          ],
        }),
      }),
      ["orders", "bulk"]
    );
    const json = await response.json();
    expect(json.data.results).toHaveLength(2);
    expect(json.data.results[0].success).toBe(true);
    expect(json.data.results[1].success).toBe(false);
  });

  it("blocks label download without labels:read", async () => {
    auth.ctx.scopes = ["tracking:read"];
    const response = await handleMerchantV1(
      req("GET", "http://localhost/api/merchant/v1/shipments/11111111-1111-4111-8111-111111111111/label"),
      ["shipments", "11111111-1111-4111-8111-111111111111", "label"]
    );
    expect((await response.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    expect(mocks.getMerchantLabel).not.toHaveBeenCalled();
  });

  it("denies webhook listing without webhooks:read", async () => {
    auth.ctx.scopes = ["orders:read"];
    const response = await handleMerchantV1(
      req("GET", "http://localhost/api/merchant/v1/webhook-subscriptions"),
      ["webhook-subscriptions"]
    );
    expect((await response.json()).error.code).toBe("INSUFFICIENT_SCOPE");
  });
});
