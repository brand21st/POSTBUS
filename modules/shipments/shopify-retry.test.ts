import { describe, expect, it, vi } from "vitest";
import { ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { retryShipment } from "@/modules/shipments/service";

const ctx: TenantContext = {
  userId: "user-1",
  email: "ops@example.com",
  fullName: "Ops",
  organizationId: "org-1",
  organizationName: "PostBus",
  role: "OPERATOR",
  permissions: ["orders.write"],
};

vi.mock("@/modules/billing/usage", () => ({
  checkQuota: vi.fn(async () => undefined),
}));

function chain(result: { data: unknown; error: null }) {
  const query: Record<string, unknown> = {};
  const self = () => query;
  query.select = self;
  query.eq = self;
  query.in = self;
  query.is = self;
  query.maybeSingle = async () => result;
  query.single = async () => result;
  return query;
}

describe("retryShipment Shopify PENDING guard", () => {
  it("does not queue a booking retry for Shopify PENDING", async () => {
    const client = {
      from: (table: string) => {
        if (table === "shipments") {
          return chain({
            data: {
              id: "ship-1",
              order_id: "ord-1",
              status: "FAILED",
              booked_at: null,
              orders: { order_number: "#1042" },
              tracking_events: [],
              shipping_invoices: [],
            },
            error: null,
          });
        }
        if (table === "orders") {
          return chain({
            data: { india_post_service: "SP_INLAND_PARCEL", source: "SHOPIFY", payment_status: "PENDING" },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      },
    };
    await expect(retryShipment(client as never, ctx, "ship-1")).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
  });

});
