import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";

vi.mock("@/modules/india-post/provider", () => ({
  indiaPostFromRow: vi.fn(() => ({
    trackShipment: vi.fn(async () => ({
      data: [
        {
          booking_details: { article_number: "AW784699994IN" },
          tracking_details: [
            {
              event_code: "DELIVERY_ATTEMPTED",
              event: "Delivery attempted",
              office: "Pandhana S.O",
              date: "2026-09-27",
              time: "10:15:00",
            },
          ],
        },
      ],
    })),
  })),
}));

vi.mock("@/modules/india-post/apply-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/modules/india-post/apply-tracking")>(
    "@/modules/india-post/apply-tracking"
  );
  return {
    ...actual,
    ingestBulkTrackingArticle: vi.fn(async () => ({
      snapshot: {
        id: "ship-a",
        organizationId: "org-a",
        orderId: "order-a",
        status: "NDR",
        operationalStatus: "NDR",
        lastEventAt: "2026-09-27T10:15:00.000Z",
        ndrAttemptCount: 1,
        rtoInitiatedAt: null,
      },
      orderStatus: null,
      whatsappEvents: [],
    })),
  };
});

const ctx = {
  userId: "user-a",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-a",
  organizationName: "PostBus",
  role: "OWNER",
  permissions: ["*"],
} as TenantContext;

const otherCtx = { ...ctx, organizationId: "org-b" } as TenantContext;

function ndrDb() {
  const shipment = {
    id: "ship-a",
    organization_id: "org-a",
    order_id: "order-a",
    barcode: "AW784699994IN",
    tracking_number: "AW784699994IN",
    status: "NDR",
    operational_status: "NDR",
    last_event_code: "DELIVERY_ATTEMPTED",
    last_event_description: "Delivery attempted",
    last_scan_office: "Pandhana S.O",
    last_event_at: "2026-09-27T10:15:00.000Z",
    ndr_reason: "Addressee cannot be located",
    ndr_attempt_count: 1,
    orders: { order_number: "PB-1001", total_amount: 499 },
    customers: { name: "Nilesh", phone: "9876543210" },
    addresses: { city: "East Nimar", pincode: "450661" },
    pickup_locations: { city: "Bangalore" },
  };

  return {
    from(table: string) {
      const api: Record<string, unknown> = {};
      api.select = () => api;
      api.eq = (column: string, value: unknown) => {
        if (table === "shipments" && column === "organization_id" && value !== "org-a") {
          api._foreign = true;
        }
        if (table === "shipments" && column === "id" && value !== "ship-a") {
          api._missing = true;
        }
        return api;
      };
      api.not = () => api;
      api.in = () => api;
      api.gte = () => api;
      api.lt = () => api;
      api.lte = () => api;
      api.or = () => api;
      api.order = () => api;
      api.range = () => api;
      api.update = () => api;
      api.maybeSingle = async () => {
        if (table === "shipments") {
          if (api._foreign || api._missing) return { data: null, error: null };
          return { data: shipment, error: null };
        }
        if (table === "india_post_connections") {
          return { data: { id: "conn-a", organization_id: "org-a", status: "CONNECTED" }, error: null };
        }
        return { data: null, error: null };
      };
      api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (table === "shipments") {
          if (api._foreign) return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
          return Promise.resolve({ data: [shipment], error: null, count: 1 }).then(resolve, reject);
        }
        return Promise.resolve({ count: 1, error: null }).then(resolve, reject);
      };
      return api;
    },
  };
}

describe("NDR RTO commerce APIs", () => {
  it("GET /api/v1/ndr-rto/summary counts inside the tenant", async () => {
    const result = await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ndr-rto/summary"),
      ndrDb() as never,
      ctx,
      "GET ndr-rto/summary",
      "GET",
      ["ndr-rto", "summary"]
    );
    expect(result).toEqual({
      delivered: 1,
      outForDelivery: 1,
      deliveredToday: 1,
      ndr: 1,
      rto: 1,
      rtoInTransit: 1,
      rtoDelivered: 1,
    });
  });

  it("GET /api/v1/ndr-rto returns mapped CEPT rows for the tenant", async () => {
    const result = (await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ndr-rto?bucket=NDR"),
      ndrDb() as never,
      ctx,
      "GET ndr-rto",
      "GET",
      ["ndr-rto"]
    )) as { items: Array<Record<string, unknown>>; total: number };

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      orderNumber: "PB-1001",
      lastEventCode: "DELIVERY_ATTEMPTED",
      ndrReason: "Addressee cannot be located",
      shippingPincode: "450661",
    });
  });

  it("GET /api/v1/ndr-rto rejects an invalid query", async () => {
    await expect(
      handleCommerceRoutes(
        new NextRequest("http://localhost:3000/api/v1/ndr-rto?page=0"),
        ndrDb() as never,
        ctx,
        "GET ndr-rto",
        "GET",
        ["ndr-rto"]
      )
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("POST /api/v1/ndr-rto/:id/sync rejects a shipment from another tenant", async () => {
    await expect(
      handleCommerceRoutes(
        new NextRequest("http://localhost:3000/api/v1/ndr-rto/ship-a/sync", { method: "POST" }),
        ndrDb() as never,
        otherCtx,
        "POST ndr-rto/ship-a/sync",
        "POST",
        ["ndr-rto", "ship-a", "sync"]
      )
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
  });

  it("POST /api/v1/ndr-rto/:id/sync applies CEPT tracking for the tenant shipment", async () => {
    const result = await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ndr-rto/ship-a/sync", { method: "POST" }),
      ndrDb() as never,
      ctx,
      "POST ndr-rto/ship-a/sync",
      "POST",
      ["ndr-rto", "ship-a", "sync"]
    );
    expect(result).toMatchObject({
      shipmentId: "ship-a",
      status: "NDR",
      operationalStatus: "NDR",
    });
  });
});
