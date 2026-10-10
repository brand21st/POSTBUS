import { describe, expect, it, vi } from "vitest";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type { TenantContext } from "@/lib/api/context";
import { ensurePersistedIndiaPostTrackingSession } from "@/modules/india-post/session";
import { ndrListQuery } from "@/modules/ndr-rto/schema";
import { getNdrSummary, istDayBounds, listNdrShipments, syncNdrShipment, syncNdrVisibleShipments } from "@/modules/ndr-rto/service";

vi.mock("@/modules/india-post/session", () => ({
  ensurePersistedIndiaPostTrackingSession: vi.fn(async () => ({
    trackShipment: vi.fn(async () => {
      throw new Error("Tracking lookup failed.");
    }),
  })),
}));

const ctx = { organizationId: "org-a", userId: "user-a", role: "OWNER" } as TenantContext;

describe("ndr list query", () => {
  it("rejects invalid page, bucket, and date values", () => {
    expect(() => ndrListQuery.parse({ page: 0 })).toThrow();
    expect(() => ndrListQuery.parse({ bucket: "RETURNED" })).toThrow();
    expect(() => ndrListQuery.parse({ from: "yesterday" })).toThrow();
    expect(() => ndrListQuery.parse({ status: "RETURNED" })).toThrow();
    expect(ndrListQuery.parse({}).page).toBe(1);
    expect(ndrListQuery.parse({ q: "  " }).q).toBeUndefined();
  });
});

describe("istDayBounds", () => {
  it("uses the Asia/Kolkata calendar day", () => {
    const bounds = istDayBounds(new Date("2026-09-26T20:00:00.000Z"));
    expect(bounds.day).toBe("2026-09-27");
    expect(bounds.start).toBe("2026-09-26T18:30:00.000Z");
    expect(Date.parse(bounds.end) - Date.parse(bounds.start)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("NDR APIs", () => {
  it("counts summary cards inside the active organization", async () => {
    const orgs: string[] = [];
    const api = {
      select() {
        return api;
      },
      eq(column: string, value: string) {
        if (column === "organization_id") orgs.push(value);
        return api;
      },
      not() {
        return api;
      },
      in() {
        return api;
      },
      gte() {
        return api;
      },
      lt() {
        return api;
      },
      is() {
        return api;
      },
      then(resolve: (value: { count: number; error: null }) => void) {
        resolve({ count: 4, error: null });
      },
    };
    const summary = await getNdrSummary({ from: () => api } as never, ctx);
    expect(summary.delivered).toBe(4);
    expect(summary.ndr).toBe(4);
    expect(summary.rtoDelivered).toBe(4);
    expect(summary.unclassifiedTracked).toBe(4);
    expect(orgs.length).toBe(8);
    expect(new Set(orgs)).toEqual(new Set(["org-a"]));
  });

  it("returns an empty page when the customer filter matches nobody in the tenant", async () => {
    const supabase = {
      from(table: string) {
        if (table !== "customers") throw new Error(`unexpected ${table}`);
        return {
          select: () => ({
            eq: () => ({
              or: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      },
    };
    const result = await listNdrShipments(supabase as never, ctx, ndrListQuery.parse({ customer: "Nobody" }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("maps nested customer and order rows for the dashboard", async () => {
    const supabase = {
      from() {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          not() {
            return api;
          },
          in() {
            return api;
          },
          order() {
            return api;
          },
          range() {
            return api;
          },
          then(resolve: (value: { data: unknown[]; error: null; count: number }) => void) {
            resolve({
              data: [
                {
                  id: "ship-a",
                  barcode: "AW784699994IN",
                  tracking_number: "AW784699994IN",
                  order_id: "order-a",
                  status: "NDR",
                  operational_status: "NDR",
                  last_event_code: "DELIVERY_ATTEMPTED",
                  last_event_description: "Delivery attempted",
                  last_scan_office: "Pandhana S.O",
                  last_event_at: "2026-09-27T10:15:00.000Z",
                  ndr_reason: "Addressee cannot be located",
                  ndr_attempt_count: 1,
                  orders: [{ order_number: "PB-1001", total_amount: 499 }],
                  customers: [{ name: "Nilesh", phone: "9876543210" }],
                  addresses: [{ city: "East Nimar", pincode: "450661" }],
                  pickup_locations: { city: "Bangalore" },
                },
              ],
              error: null,
              count: 1,
            });
          },
        };
        return api;
      },
    };
    const result = await listNdrShipments(supabase as never, ctx, ndrListQuery.parse({ bucket: "NDR" }));
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      orderNumber: "PB-1001",
      customer: { name: "Nilesh", phone: "9876543210" },
      shippingCity: "East Nimar",
      shippingPincode: "450661",
      originCity: "Bangalore",
      lastEventCode: "DELIVERY_ATTEMPTED",
      ndrReason: "Addressee cannot be located",
    });
  });

  it("fills Event and Last Scan from the latest India Post tracking event", async () => {
    const supabase = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          not() {
            return api;
          },
          in() {
            return api;
          },
          order() {
            return api;
          },
          range() {
            return api;
          },
          then(resolve: (value: { data: unknown[]; error: null; count?: number }) => void) {
            if (table === "tracking_events") {
              resolve({
                data: [
                  {
                    shipment_id: "ship-a",
                    event_code: "ITEM_BAGGED",
                    event_description: "Item bagged",
                    office_name: "Navi Mumbai RMS",
                    occurred_at: "2026-10-10T06:10:00.000Z",
                    classification: "IN_TRANSIT",
                  },
                ],
                error: null,
              });
              return;
            }
            resolve({
              data: [
                {
                  id: "ship-a",
                  barcode: "CL214330016IN",
                  tracking_number: "CL214330016IN",
                  status: "MANIFEST_READY",
                  last_event_code: null,
                  last_event_description: null,
                  last_scan_office: null,
                  last_event_at: null,
                  orders: { order_number: "#2118" },
                  customers: { name: "Premal More" },
                },
              ],
              error: null,
              count: 1,
            });
          },
        };
        return api;
      },
    };
    const result = await listNdrShipments(supabase as never, ctx, ndrListQuery.parse({}));
    expect(result.items[0]).toMatchObject({
      lastEventCode: "ITEM_BAGGED",
      lastEventDescription: "Item bagged",
      lastScanOffice: "Navi Mumbai RMS",
      lastEventAt: "2026-10-10T06:10:00.000Z",
    });
  });

  it("does not load another tenant shipment and reports India Post failures", async () => {
    const filters: string[] = [];
    const supabase = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq(column: string, value: string) {
            filters.push(`${table}.${column}:${value}`);
            return api;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return api;
      },
    };
    await expect(syncNdrShipment(supabase as never, ctx, "ship-b")).rejects.toMatchObject({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
    expect(filters).toContain("shipments.organization_id:org-a");
    expect(filters).toContain("shipments.id:ship-b");
    expect(ensurePersistedIndiaPostTrackingSession).not.toHaveBeenCalled();

    const connected = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle: async () => ({
            data:
              table === "shipments"
                ? { id: "ship-a", barcode: "AW784699994IN", status: "IN_TRANSIT", order_id: "order-a", organization_id: "org-a" }
                : { id: "conn-a", status: "CONNECTED" },
            error: null,
          }),
        };
        return api;
      },
    };
    await expect(syncNdrShipment(connected as never, ctx, "ship-a")).rejects.toBeInstanceOf(AppError);
    await expect(syncNdrShipment(connected as never, ctx, "ship-a")).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
    });
  });

  it("tracks visible page AWBs in one India Post bulk request", async () => {
    const trackShipment = vi.fn(async (barcodes: string[]) => ({
      data: barcodes.map((article_number) => ({
        booking_details: { article_number },
        tracking_details: [{ event: "Item Dispatched", office: "Mumbai GPO", date: "2026-10-10", time: "10:00:00" }],
      })),
    }));
    vi.mocked(ensurePersistedIndiaPostTrackingSession).mockResolvedValueOnce({ trackShipment } as never);
    const ingested: string[] = [];
    const supabase = {
      from(table: string) {
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          in() {
            return api;
          },
          not() {
            return api;
          },
          update() {
            return api;
          },
          maybeSingle: async () => ({
            data: table === "india_post_connections" ? { id: "conn-a", status: "CONNECTED" } : null,
            error: null,
          }),
          then(resolve: (value: { data: unknown[]; error: null }) => void) {
            if (table === "shipments") {
              resolve({
                data: [
                  { id: "ship-a", barcode: "CL214330016IN", status: "MANIFEST_READY", order_id: "o1", organization_id: "org-a" },
                  { id: "ship-b", barcode: "CL556973995IN", status: "MANIFEST_READY", order_id: "o2", organization_id: "org-a" },
                ],
                error: null,
              });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return api;
      },
    };
    const apply = await import("@/modules/india-post/apply-tracking");
    const ingest = vi.spyOn(apply, "ingestBulkTrackingArticle").mockImplementation(async (_db, input) => {
      ingested.push(input.shipment.id);
      return {
        snapshot: {
          id: input.shipment.id,
          organizationId: "org-a",
          orderId: input.shipment.orderId,
          status: "IN_TRANSIT",
          operationalStatus: "IN_TRANSIT",
          lastEventAt: "2026-10-10T04:30:00.000Z",
          ndrAttemptCount: 0,
          rtoInitiatedAt: null,
        },
        orderStatus: null,
        whatsappEvents: [],
        inserted: true,
        duplicate: false,
        statusUpdated: true,
        shipmentStatus: "IN_TRANSIT",
        operationalStatus: "IN_TRANSIT",
      };
    });

    const result = await syncNdrVisibleShipments(supabase as never, ctx, ["ship-a", "ship-b"]);
    expect(trackShipment).toHaveBeenCalledTimes(1);
    expect(trackShipment).toHaveBeenCalledWith(["CL214330016IN", "CL556973995IN"], { isolateFailures: false });
    expect(result).toMatchObject({ tracked: 2, matched: 2 });
    expect(ingested).toEqual(["ship-a", "ship-b"]);
    ingest.mockRestore();
  });
});
