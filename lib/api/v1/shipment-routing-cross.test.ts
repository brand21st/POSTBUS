import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import { processIndiaPostInboxEvent } from "@/modules/india-post/webhook";
import type { TrackingEvent } from "@/types/api";

vi.mock("@/modules/webhooks/outgoing", () => ({
  emitWebhook: vi.fn(async () => undefined),
}));

vi.mock("@/modules/india-post/tracking-effects", () => ({
  enqueueTrackingStageSideEffects: vi.fn(async () => undefined),
}));

const ctx = {
  userId: "user-a",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-a",
  organizationName: "PostBus",
  role: "OWNER",
  permissions: ["*"],
} as TenantContext;

type EventRow = Record<string, unknown>;

function crossDb() {
  const events: EventRow[] = [];
  let shipment: Record<string, unknown> = {
    id: "ship-cross",
    organization_id: "org-a",
    order_id: "order-cross",
    barcode: "AW784699994IN",
    tracking_number: "AW784699994IN",
    status: "BOOKED",
    operational_status: "BOOKED",
    booked_at: "2025-11-09T08:32:11.000Z",
    service_code: "SP_INLAND_PARCEL",
    last_event_at: null,
    ndr_attempt_count: 0,
    rto_initiated_at: null,
    orders: { order_number: "PB-CROSS-1", total_amount: 499, created_at: "2025-11-09T08:00:00.000Z" },
    customers: { name: "Nilesh", phone: "9876543210" },
    addresses: { city: "East Nimar", pincode: "450661" },
    pickup_locations: { city: "BANGALORE", name: "KADUGODI BNPL CENTRE" },
    shipping_invoices: [],
    labels: [],
  };
  const inbox = {
    id: "inbox-cross",
    organization_id: "org-a",
    channel: "events",
    process_status: "PENDING",
    raw_payload: {
      article_number: "AW784699994IN",
      event_code: "BAG_CLOSE",
      event_description: "Bag Close",
      event_date: "2025-11-09",
      event_time: "08:37:52",
      event_office_name: "KADUGODI BNPL CENTRE",
    },
    received_at: "2025-11-09T08:37:52.000Z",
  };

  return {
    events,
    get shipment() {
      return shipment;
    },
    from(table: string) {
      const state: { patch?: Record<string, unknown>; filters: Record<string, unknown> } = { filters: {} };
      const api: Record<string, unknown> = {};
      api.select = () => api;
      api.insert = (row: EventRow) => {
        if (table === "tracking_events") {
          events.push({ id: `ev-${events.length + 1}`, ...row });
        }
        return Promise.resolve({ error: null });
      };
      api.update = (patch: Record<string, unknown>) => {
        state.patch = patch;
        return api;
      };
      api.eq = (column: string, value: unknown) => {
        state.filters[column] = value;
        return api;
      };
      api.maybeSingle = async () => {
        if (table === "provider_webhook_inbox") return { data: inbox, error: null };
        if (table === "shipments") {
          if (state.filters.barcode && state.filters.barcode !== shipment.barcode) {
            return { data: null, error: null };
          }
          if (state.filters.tracking_number && state.filters.tracking_number !== shipment.tracking_number) {
            return { data: null, error: null };
          }
          if (state.filters.organization_id && state.filters.organization_id !== "org-a") {
            return { data: null, error: null };
          }
          if (state.filters.id && state.filters.id !== shipment.id) {
            return { data: null, error: null };
          }
          return { data: { ...shipment, tracking_events: events }, error: null };
        }
        return { data: null, error: null };
      };
      api.then = (resolve: (value: { error: null }) => void) => {
        if (state.patch) {
          if (table === "shipments") shipment = { ...shipment, ...state.patch };
          if (table === "provider_webhook_inbox") Object.assign(inbox, state.patch);
        }
        resolve({ error: null });
      };
      return api;
    },
  };
}

describe("webhook to shipment detail Routing Steps", () => {
  it("CEPT inbox process writes scans that GET /shipments/:id renders as Routing Steps", async () => {
    const db = crossDb();
    const processed = await processIndiaPostInboxEvent(db as never, "inbox-cross", "org-a");
    expect(processed).toEqual({ processed: true, shipmentId: "ship-cross" });
    expect(db.events).toHaveLength(1);
    expect(db.shipment.last_event_description).toBe("Bag Close");

    const result = (await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/shipments/ship-cross"),
      db as never,
      ctx,
      "GET shipments/ship-cross",
      "GET",
      ["shipments", "ship-cross"]
    )) as Record<string, unknown> & { events?: TrackingEvent[] };

    expect(result.events).toHaveLength(1);
    expect(result.events?.[0]).toMatchObject({
      eventCode: "BAG_CLOSE",
      eventDescription: "Bag Close",
      officeName: "KADUGODI BNPL CENTRE",
    });

    const view = buildIndiaPostRoutingView(result as never, result.events ?? []);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]).toMatchObject({
      title: "Bag Close",
      office: "KADUGODI BNPL CENTRE",
      latest: true,
    });
    expect(view.steps[0]?.dateLabel).not.toBe("—");
    expect(view.currentEvent).toBe("Bag Close");
    expect(view.stages.find((stage) => stage.stage === "DISPATCHED")?.current).toBe(true);
  });
});
