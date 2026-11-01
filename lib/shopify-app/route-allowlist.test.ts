import { describe, expect, it } from "vitest";
import { isShopifyAppRouteAllowed } from "@/lib/shopify-app/route-allowlist";

describe("Shopify app v1 route allowlist", () => {
  it.each([
    ["GET", "orders"],
    ["GET", "orders/ord-1"],
    ["PATCH", "orders/ord-1/weights"],
    ["POST", "orders/ord-1/tariff-quote"],
    ["POST", "bookings/queue"],
    ["POST", "shipments"],
    ["POST", "shipments/s-1/retry"],
    ["GET", "labels/l-1/download"],
    ["POST", "labels/bulk-download"],
    ["POST", "manifests"],
    ["GET", "tracking"],
    ["POST", "integrations/india-post/verify"],
    ["PATCH", "integrations/india-post/parcel-defaults"],
    ["PATCH", "automation"],
    ["get", "billing/usage"],
  ])("allows %s %s", (method, path) => {
    expect(isShopifyAppRouteAllowed(method, path)).toBe(true);
  });

  it.each([
    ["POST", "billing/subscribe"],
    ["POST", "billing/ai-credits/checkout"],
    ["POST", "api-keys"],
    ["POST", "members/invites"],
    ["POST", "organizations/switch"],
    ["PATCH", "organizations"],
    ["POST", "labels/bulk-print"],
    ["GET", "audit-logs"],
    ["DELETE", "orders/ord-1"],
    ["GET", "orders/ord-1/extra/segments"],
    ["GET", "shipments/../api-keys"],
    ["PATCH", "integrations/india-post/parcel-defaults/x"],
    ["POST", "integrations/shopify/sync"],
  ])("blocks %s %s", (method, path) => {
    expect(isShopifyAppRouteAllowed(method, path)).toBe(false);
  });
});
