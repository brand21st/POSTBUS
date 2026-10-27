import { describe, expect, it, vi } from "vitest";
import { classifyProviderError } from "@/lib/jobs/retry";
import { isBlockedIp, nextStoreRedirect, parsePublicStoreUrl } from "@/lib/security/outbound-url";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { shipmentCollectFromOrder } from "@/modules/orders/payment";
import { merchantWooError, WooCommerceRequestError, wooRequest, wooRequestUrl } from "@/modules/woocommerce/client";
import { decideWooAuthCallback, publicWooConnection } from "@/modules/woocommerce/connect";
import { mapWooOrder, type WooRemoteOrder } from "@/modules/woocommerce/map-order";
import { mapWooPayment } from "@/modules/woocommerce/payment";
import { isPostbusEchoUpdate, shouldApplyWooOrder, verifyWooWebhookSignature, wooWebhookSignature } from "@/modules/woocommerce/signature";
import { redactWooText, wooHasMorePages, wooOrderListQuery } from "@/modules/woocommerce/sync-window";
import { shouldAddTrackingNote, wooStatusForStage, wooTrackingBody } from "@/modules/woocommerce/tracking";
import { normalizeWooLengthToCm, normalizeWooWeightToGrams, readWooMeasurementUnits } from "@/modules/woocommerce/units";
import { parseWooWebhookPath } from "@/modules/woocommerce/webhooks";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === "shop.example") return [{ address: "93.184.216.34", family: 4 }];
    if (host === "internal.example") return [{ address: "10.1.1.5", family: 4 }];
    throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
  }),
}));

const baseOrder: WooRemoteOrder = {
  id: 1001,
  number: "1001",
  status: "processing",
  currency: "INR",
  date_created: "2026-10-01T00:00:00",
  date_modified: "2026-10-02T00:00:00",
  date_paid: "2026-10-01T00:00:00",
  payment_method: "razorpay",
  payment_method_title: "Cash on delivery",
  total: "590.00",
  discount_total: "10",
  shipping_total: "40",
  total_tax: "90",
  billing: {
    first_name: "Asha",
    last_name: "Nair",
    email: "asha@example.com",
    phone: "9876543210",
    address_1: "12 Beach Road",
    city: "Kochi",
    state: "KL",
    postcode: "682001",
  },
  shipping: {
    first_name: "Asha",
    last_name: "Nair",
    phone: "9876543210",
    address_1: "12 Beach Road",
    city: "Kochi",
    state: "KL",
    postcode: "682001",
  },
  line_items: [
    {
      name: "Cotton saree",
      product_id: 9,
      variation_id: 44,
      quantity: 2,
      sku: "SAR-1",
      total: "500",
      meta_data: [{ key: "pa_color", value: "Red" }],
    },
  ],
};

describe("WooCommerce connection", () => {
  it("rejects private and non-https store URLs", async () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("10.0.0.8")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("192.168.1.9")).toBe(true);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(() => parsePublicStoreUrl("http://shop.example")).toThrow(/HTTPS/);
    expect(() => parsePublicStoreUrl("https://127.0.0.1/store")).toThrow(/cannot be used/);
    const { assertPublicHttpsUrl } = await import("@/lib/security/outbound-url");
    await expect(assertPublicHttpsUrl("https://internal.example")).rejects.toThrow(/cannot be used/);
    await expect(assertPublicHttpsUrl("https://shop.example")).resolves.toMatchObject({
      addresses: ["93.184.216.34"],
    });
    const current = new URL("https://shop.example/store");
    expect(() => nextStoreRedirect(current, "https://127.0.0.1/secret")).toThrow(/cannot be used/);
    expect(nextStoreRedirect(current, "/wp-json/wc/v3").host).toBe("shop.example");
  });

  it("approves, rejects, and dedupes authorization callbacks", () => {
    expect(decideWooAuthCallback({ permissions: "read_write", stateFound: true, expired: false, alreadyUsed: false })).toEqual({
      ok: true,
      duplicate: false,
    });
    expect(decideWooAuthCallback({ permissions: "read", stateFound: true, expired: false, alreadyUsed: false }).ok).toBe(false);
    expect(decideWooAuthCallback({ permissions: "read_write", stateFound: false, expired: false, alreadyUsed: false }).ok).toBe(false);
    expect(decideWooAuthCallback({ permissions: "read", stateFound: true, expired: false, alreadyUsed: true })).toEqual({
      ok: true,
      duplicate: true,
    });
  });

  it("encrypts consumer secrets and omits them from the status payload", () => {
    const secret = "cs_live_super_secret_value";
    const encrypted = encryptSecret(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
    expect(encrypted).not.toContain(secret);
    const view = publicWooConnection({
      id: "conn",
      organization_id: "org-a",
      store_url: "https://shop.example",
      store_host: "shop.example",
      status: "CONNECTED",
      encrypted_consumer_key: encryptSecret("ck_live_key"),
      encrypted_consumer_secret: encrypted,
      sync_enabled: true,
    });
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(JSON.stringify(view)).not.toContain("ck_live_key");
    expect(view.hasCredentials).toBe(true);
    expect(view.storeHost).toBe("shop.example");
  });
});

describe("WooCommerce orders", () => {
  it("maps prepaid, COD, variations, missing phone, and bad pincodes", () => {
    const prepaid = mapWooOrder(baseOrder);
    expect(prepaid.payment.paymentStatus).toBe("PAID");
    expect(prepaid.payment.codAmount).toBe(0);
    expect(prepaid.lines[0].title).toContain("Red");
    expect(prepaid.customer.phone).toBe("9876543210");

    const cod = mapWooPayment({ paymentMethod: "cod", paymentMethodTitle: "Pay now", total: "500", status: "processing" });
    expect(cod.paymentStatus).toBe("COD");
    expect(cod.codAmount).toBe(500);
    const titled = mapWooPayment({
      paymentMethod: "bacs",
      paymentMethodTitle: "Cash on delivery",
      total: "500",
      status: "processing",
      datePaid: "2026-10-01",
    });
    expect(titled.paymentStatus).toBe("PAID");

    const refundedCod = mapWooPayment({ paymentMethod: "cod", total: "500", refundTotal: "100", status: "processing" });
    expect(refundedCod.codAmount).toBe(400);
    expect(
      shipmentCollectFromOrder({
        payment_status: refundedCod.paymentStatus,
        total_amount: 500,
        cod_amount: refundedCod.codAmount,
        amount_paid: refundedCod.amountPaid,
      }).cod_amount
    ).toBe(400);

    const missing = mapWooOrder({
      ...baseOrder,
      billing: { ...baseOrder.billing, phone: "" },
      shipping: { ...baseOrder.shipping, phone: "123", postcode: "1234" },
    });
    expect(missing.issues).toContain("Missing customer phone");
    expect(missing.issues).toContain("Invalid shipping pincode");

    const cancelled = mapWooOrder({ ...baseOrder, status: "cancelled" });
    expect(cancelled.terminal).toBe(true);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("paginates and builds an incremental cursor", () => {
    expect(wooHasMorePages(1, 3)).toBe(true);
    expect(wooHasMorePages(3, 3)).toBe(false);
    const incremental = wooOrderListQuery(
      { incremental: true, lastSuccessfulSyncAt: "2026-10-20T00:00:00.000Z" },
      2
    );
    expect(incremental.page).toBe("2");
    expect(incremental.per_page).toBe("100");
    expect(incremental.modified_after).toBeTruthy();
    const initial = wooOrderListQuery({ importDays: 7 }, 1);
    expect(initial.after).toBeTruthy();
    expect(initial.modified_after).toBeUndefined();
  });

  it("normalizes store measurement units", () => {
    expect(normalizeWooWeightToGrams("1.5", "kg")).toBe(1500);
    expect(normalizeWooWeightToGrams("2", "lbs")).toBe(907);
    expect(normalizeWooLengthToCm("10", "mm")).toBe(1);
    const units = readWooMeasurementUnits([
      { id: "woocommerce_weight_unit", value: "g" },
      { id: "woocommerce_dimension_unit", value: "in" },
    ]);
    expect(units).toEqual({ weightUnit: "g", dimensionUnit: "in" });
    const mapped = mapWooOrder(baseOrder, {
      weightUnit: "kg",
      dimensionUnit: "cm",
      measures: new Map([["9:44", { weight: "0.25", dimensions: { length: "10", width: "8", height: "2" } }]]),
    });
    expect(mapped.lines[0].weightGrams).toBe(250);
    expect(mapped.lines[0].lengthCm).toBe(10);
  });
});

describe("WooCommerce webhooks", () => {
  it("verifies signatures and ignores spoofed or stale deliveries", () => {
    const raw = JSON.stringify({ id: 1001, status: "processing" });
    const secret = "whsec_test";
    const good = wooWebhookSignature(secret, raw);
    expect(verifyWooWebhookSignature(secret, raw, good)).toBe(true);
    expect(verifyWooWebhookSignature(secret, raw, "not-the-signature")).toBe(false);
    expect(verifyWooWebhookSignature("", raw, good)).toBe(false);
    expect(parseWooWebhookPath("webhooks/woocommerce/11111111-1111-1111-1111-111111111111")).toEqual({
      kind: "delivery",
      connectionId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parseWooWebhookPath("webhooks/woocommerce/auth")).toEqual({ kind: "auth" });
    expect(parseWooWebhookPath("webhooks/woocommerce/org-from-payload")).toBeNull();
    expect(
      shouldApplyWooOrder({
        topic: "order.updated",
        incomingModified: "2026-10-01T00:00:00.000Z",
        storedModified: "2026-10-02T00:00:00.000Z",
      })
    ).toBe(false);
    expect(shouldApplyWooOrder({ topic: "order.deleted", incomingModified: "2020-01-01", storedModified: "2026-10-02" })).toBe(
      true
    );
    expect(
      isPostbusEchoUpdate({
        previousStatus: "processing",
        nextStatus: "processing",
        previousTotal: "590.00",
        nextTotal: "590.00",
        meta: [{ key: "_postbus_tracking_number", value: "EX123IN" }],
      })
    ).toBe(true);
    expect(
      isPostbusEchoUpdate({
        previousStatus: "processing",
        nextStatus: "completed",
        previousTotal: "590.00",
        nextTotal: "590.00",
        meta: [{ key: "_postbus_tracking_number", value: "EX123IN" }],
      })
    ).toBe(false);
  });
});

describe("WooCommerce tracking", () => {
  it("writes AWB metadata and does not complete an order just because an AWB exists", () => {
    const payload = wooTrackingBody({ awb: "EX123IN", note: false });
    expect(payload.note).toBe(false);
    expect(payload.body.meta_data).toEqual([
      { key: "_postbus_tracking_number", value: "EX123IN" },
      { key: "_postbus_tracking_url", value: expect.stringContaining("EX123IN") },
      { key: "_postbus_carrier", value: "India Post" },
    ]);
    expect(payload.body.status).toBeUndefined();
    expect(wooStatusForStage({ stage: "booked", updateOrderStatus: true, statusMap: { delivered: "completed" } })).toBeNull();
    expect(wooStatusForStage({ stage: "delivered", updateOrderStatus: false, statusMap: { delivered: "completed" } })).toBeNull();
    expect(wooStatusForStage({ stage: "delivered", updateOrderStatus: true, statusMap: { delivered: "completed" } })).toBe(
      "completed"
    );
    expect(shouldAddTrackingNote({ addTrackingNote: false })).toBe(false);
    expect(shouldAddTrackingNote({ addTrackingNote: true })).toBe(true);
  });

  it("classifies WooCommerce rate limits as retryable", () => {
    const error = new WooCommerceRequestError(429, merchantWooError(429));
    expect(classifyProviderError(error).retryable).toBe(true);
    expect(classifyProviderError(new WooCommerceRequestError(401, merchantWooError(401))).retryable).toBe(false);
  });
});

describe("WooCommerce client", () => {
  it("keeps credentials out of the URL and logs", async () => {
    const url = wooRequestUrl("https://shop.example", "/wp-json/wc/v3/orders", { per_page: "1" });
    expect(url.search).not.toContain("consumer_key");
    expect(() => wooRequestUrl("https://shop.example", "/wp-json/wc/v3/orders", { consumer_key: "ck_live" })).toThrow(
      /must not/
    );
    const secret = "ck_live_should_not_leak";
    expect(redactWooText(`failed ${secret} consumer_secret=cs_live_abc`)).not.toContain(secret);
    const result = await wooRequest(
      { storeUrl: "https://shop.example", consumerKey: secret, consumerSecret: "cs_live_secret" },
      "/wp-json/wc/v3/orders",
      {
        query: { per_page: "1" },
        transport: async (target, init) => {
          expect(target).not.toContain(secret);
          expect(init.headers?.Authorization?.startsWith("Basic ")).toBe(true);
          return {
            status: 200,
            headers: { "x-wp-totalpages": "4" },
            body: "[]",
          };
        },
      }
    );
    expect(result.status).toBe(200);
  });

  it("maps invalid credentials to a merchant-facing message", async () => {
    await expect(
      wooRequest(
        { storeUrl: "https://shop.example", consumerKey: "ck", consumerSecret: "cs" },
        "/wp-json/wc/v3/orders",
        {
          transport: async () => ({ status: 401, headers: {}, body: "{\"code\":\"woocommerce_rest_authentication_error\"}" }),
        }
      )
    ).rejects.toThrow(/reconnect your store/);
  });
});
