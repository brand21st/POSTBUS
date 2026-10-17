import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/context";
import { ERROR_CODES } from "@/lib/api/errors";
import { handleCommerceRoutes } from "@/lib/api/v1/commerce";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import type { TrackingEvent } from "@/types/api";

vi.mock("@/modules/india-post/session", () => ({
  ensurePersistedIndiaPostTrackingSession: vi.fn(async () => ({
    trackShipment: vi.fn(async () => ({
      data: [
        {
          booking_details: { article_number: "CX075250656IN" },
          tracking_details: [
            {
              event_code: "ITEM_BOOKED",
              event: "Item Booked",
              office: "Pulikkal SO",
              date: "2026-10-09",
              time: "06:03:44",
            },
            {
              event_code: "ITEM_DISPATCHED",
              event: "Item Dispatched",
              office: "Kozhikode PH",
              date: "2026-10-09",
              time: "23:14:05",
            },
            {
              event_code: "BAG_RECEIVED",
              event: "Bag Received",
              office: "Kollam RMS",
              date: "2026-10-10",
              time: "01:40:00",
            },
          ],
        },
      ],
    })),
  })),
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

const otherCtx = { ...ctx, organizationId: "org-b" } as TenantContext;

type EventRow = {
  id: string;
  event_code: string;
  event_description: string | null;
  office_name: string | null;
  occurred_at: string;
};

function routingDb(seedEvents: EventRow[] = []) {
  const events: EventRow[] = [...seedEvents];
  const shipment: Record<string, unknown> = {
    id: "ship-route",
    organization_id: "org-a",
    order_id: "order-route",
    barcode: "CX075250656IN",
    tracking_number: "CX075250656IN",
    status: "MANIFEST_READY",
    operational_status: "BOOKED",
    booked_at: "2026-10-09T06:03:44.000Z",
    service_code: "BUSINESS_PARCEL",
    last_event_code: seedEvents.at(-1)?.event_code ?? null,
    last_event_description: seedEvents.at(-1)?.event_description ?? null,
    last_scan_office: seedEvents.at(-1)?.office_name ?? null,
    last_event_at: seedEvents.at(-1)?.occurred_at ?? null,
    last_tracked_at: null,
    ndr_attempt_count: 0,
    rto_initiated_at: null,
    orders: { order_number: "PB-ROUTE-1", total_amount: 499, created_at: "2026-10-09T05:00:00.000Z" },
    customers: { name: "Amina", phone: "9876543210" },
    addresses: { city: "Eravipuram SO", pincode: "691011" },
    pickup_locations: { city: "Pulikkal SO", name: "Pulikkal SO" },
    shipping_invoices: [],
    labels: [],
    tracking_events: events,
  };

  return {
    events,
    shipment,
    from(table: string) {
      const state: {
        filters: Record<string, unknown>;
        patch?: Record<string, unknown>;
        foreign?: boolean;
        missing?: boolean;
      } = { filters: {} };
      const api: Record<string, unknown> = {};
      api.select = () => api;
      api.insert = (row: EventRow & Record<string, unknown>) => {
        if (table !== "tracking_events") return Promise.resolve({ error: null });
        const duplicate = events.some(
          (event) => event.event_code === row.event_code && event.occurred_at === row.occurred_at
        );
        if (duplicate) {
          return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
        }
        events.push({
          id: `ev-${events.length + 1}`,
          event_code: String(row.event_code),
          event_description: (row.event_description as string | null) ?? null,
          office_name: (row.office_name as string | null) ?? null,
          occurred_at: String(row.occurred_at),
        });
        return Promise.resolve({ error: null });
      };
      api.update = (patch: Record<string, unknown>) => {
        state.patch = patch;
        return api;
      };
      api.eq = (column: string, value: unknown) => {
        state.filters[column] = value;
        if (table === "shipments" && column === "organization_id" && value !== "org-a") state.foreign = true;
        if (table === "shipments" && column === "id" && value !== "ship-route") state.missing = true;
        return api;
      };
      api.maybeSingle = async () => {
        if (table === "india_post_connections") {
          return { data: { id: "conn-a", organization_id: "org-a", status: "CONNECTED" }, error: null };
        }
        if (table === "shipments") {
          if (state.foreign || state.missing) return { data: null, error: null };
          return { data: { ...shipment, tracking_events: events }, error: null };
        }
        return { data: null, error: null };
      };
      api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (state.patch && table === "shipments" && !state.foreign && !state.missing) {
          Object.assign(shipment, state.patch);
        }
        return Promise.resolve({ error: null }).then(resolve, reject);
      };
      return api;
    },
  };
}

async function getShipmentDetail(db: ReturnType<typeof routingDb>, tenant = ctx) {
  return handleCommerceRoutes(
    new NextRequest("http://localhost:3000/api/v1/shipments/ship-route"),
    db as never,
    tenant,
    "GET shipments/ship-route",
    "GET",
    ["shipments", "ship-route"]
  ) as Promise<Record<string, unknown> & { events?: TrackingEvent[] }>;
}

describe("shipment detail routing API", () => {
  it("GET /api/v1/shipments/:id returns tracking events that build Routing Steps", async () => {
    const db = routingDb([
      {
        id: "ev-1",
        event_code: "ITEM_BOOKED",
        event_description: "Item Booked",
        office_name: "Pulikkal SO",
        occurred_at: "2026-10-09T06:03:44.000Z",
      },
      {
        id: "ev-2",
        event_code: "ITEM_DISPATCHED",
        event_description: "Item Dispatched",
        office_name: "Kozhikode PH",
        occurred_at: "2026-10-09T23:14:05.000Z",
      },
    ]);

    const result = await getShipmentDetail(db);
    expect(result.events).toHaveLength(2);
    expect(result.events?.[0]).toMatchObject({
      eventCode: "ITEM_BOOKED",
      eventDescription: "Item Booked",
      officeName: "Pulikkal SO",
      occurredAt: "2026-10-09T06:03:44.000Z",
    });

    const view = buildIndiaPostRoutingView(result as never, result.events ?? []);
    expect(view.steps).toHaveLength(2);
    expect(view.steps.map((step) => step.title)).toEqual(["Item Booked", "Item Dispatched"]);
    expect(view.steps[1]?.latest).toBe(true);
    expect(view.currentEvent).toBe("Item Dispatched");
    expect(view.articleNumber).toBe("CX075250656IN");
  });

  it("GET /api/v1/shipments/:id hides another tenant's shipment", async () => {
    await expect(getShipmentDetail(routingDb(), otherCtx)).rejects.toMatchObject({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it("GET /api/v1/shipments/:id keeps Routing Steps empty until India Post stores a scan", async () => {
    const result = await getShipmentDetail(routingDb());
    expect(result.events).toEqual([]);
    const view = buildIndiaPostRoutingView(result as never, result.events ?? []);
    expect(view.steps).toEqual([]);
    expect(view.stages[0]).toMatchObject({ stage: "BOOKED", current: true });
  });

  it("POST /api/v1/ndr-rto/:id/sync writes CEPT scans that GET then renders as Routing Steps", async () => {
    const db = routingDb();
    const synced = await handleCommerceRoutes(
      new NextRequest("http://localhost:3000/api/v1/ndr-rto/ship-route/sync", { method: "POST" }),
      db as never,
      ctx,
      "POST ndr-rto/ship-route/sync",
      "POST",
      ["ndr-rto", "ship-route", "sync"]
    );
    expect(synced).toMatchObject({ matched: true, shipmentId: "ship-route" });
    expect(db.events).toHaveLength(3);

    const result = await getShipmentDetail(db);
    expect(result.events).toHaveLength(3);
    const view = buildIndiaPostRoutingView(result as never, result.events ?? []);
    expect(view.steps.map((step) => step.title)).toEqual(["Item Booked", "Item Dispatched", "Bag Received"]);
    expect(view.steps.map((step) => step.office)).toEqual(["Pulikkal SO", "Kozhikode PH", "Kollam RMS"]);
    expect(view.steps.every((step) => step.dateLabel !== "—")).toBe(true);
    expect(view.currentEvent).toBe("Bag Received");
    expect(view.stages.find((stage) => stage.stage === "IN_TRANSIT")?.current).toBe(true);
  });
});
