import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyIndiaPostTracking,
  bulkEventOccurredAt,
  ingestBulkTrackingArticle,
  isTrackingPollStatus,
  matchingBulkTrackingArticle,
  TRACKING_POLL_STATUSES,
  type ShipmentTrackingSnapshot,
} from "@/modules/india-post/apply-tracking";
import { planTrackingUpdate, mapIndiaPostEventToShipmentUpdate } from "@/modules/india-post/event-mapper";
import { processIndiaPostInboxEvent } from "@/modules/india-post/webhook";

function snapshot(overrides: Partial<ShipmentTrackingSnapshot> = {}): ShipmentTrackingSnapshot {
  return {
    id: "ship-1",
    organizationId: "org-1",
    orderId: "order-1",
    status: "IN_TRANSIT",
    operationalStatus: "IN_TRANSIT",
    lastEventAt: "2026-09-01T00:00:00.000Z",
    ndrAttemptCount: 0,
    rtoInitiatedAt: null,
    ...overrides,
  };
}

function memorySupabase() {
  const events: Record<string, unknown>[] = [];
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const state: { patch?: Record<string, unknown> } = {};
      const api = {
        insert(row: Record<string, unknown>) {
          const key = `${row.organization_id}|${row.shipment_id}|${row.event_code}|${row.occurred_at}`;
          const duplicate = events.some(
            (event) => `${event.organization_id}|${event.shipment_id}|${event.event_code}|${event.occurred_at}` === key
          );
          if (duplicate) return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          events.push(row);
          return Promise.resolve({ error: null });
        },
        update(patch: Record<string, unknown>) {
          state.patch = patch;
          return api;
        },
        eq() {
          return api;
        },
        then(resolve: (value: { error: null }) => void) {
          if (state.patch) updates.push({ table, patch: state.patch });
          resolve({ error: null });
        },
      };
      return api;
    },
  };
  return { client: client as unknown as SupabaseClient, events, updates };
}

describe("planTrackingUpdate", () => {
  it("lets a newer out-for-delivery scan replace NDR and a later delivery close it", () => {
    const ndr = mapIndiaPostEventToShipmentUpdate({
      eventCode: "OFD",
      eventDescription: "Out for delivery",
    });
    const afterNdr = planTrackingUpdate({
      currentStatus: "NDR",
      currentOperational: "NDR",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-02T00:00:00.000Z",
      mapped: ndr,
    });
    expect(afterNdr.applyStatus).toBe(true);
    expect(afterNdr.shipmentStatus).toBe("OUT_FOR_DELIVERY");
    expect(afterNdr.whatsappEvents).toEqual(["in_transit"]);

    const delivered = planTrackingUpdate({
      currentStatus: "NDR",
      currentOperational: "NDR",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-03T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "ITEM_DELIVERED", eventDescription: "Item Delivered" }),
    });
    expect(delivered.orderStatus).toBe("DELIVERED");
    expect(delivered.operationalStatus).toBe("DELIVERED");
    expect(delivered.whatsappEvents).toEqual(["delivered"]);
  });

  it("queues in_transit WhatsApp when a booked article first moves", () => {
    const plan = planTrackingUpdate({
      currentStatus: "BOOKED",
      currentOperational: "BOOKED",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-02T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "BAG_CLOSE", eventDescription: "Bag Close" }),
    });
    expect(plan.orderStatus).toBe("IN_TRANSIT");
    expect(plan.whatsappEvents).toEqual(["in_transit"]);
  });

  it("queues in_transit WhatsApp on first out-for-delivery after the article is already moving", () => {
    const plan = planTrackingUpdate({
      currentStatus: "IN_TRANSIT",
      currentOperational: "IN_TRANSIT",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-02T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "OFD", eventDescription: "Out for delivery" }),
    });
    expect(plan.orderStatus).toBeNull();
    expect(plan.whatsappEvents).toEqual(["in_transit"]);
  });

  it("does not queue WhatsApp for a later in-transit scan", () => {
    const plan = planTrackingUpdate({
      currentStatus: "IN_TRANSIT",
      currentOperational: "IN_TRANSIT",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-02T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "ITEM_RECEIVED", eventDescription: "Item Received" }),
    });
    expect(plan.applyStatus).toBe(true);
    expect(plan.whatsappEvents).toEqual([]);
  });

  it("queues shipment_delayed WhatsApp when India Post reports a delay", () => {
    const mapped = mapIndiaPostEventToShipmentUpdate({
      eventCode: "ITEM_DELAYED",
      eventDescription: "Item Delayed",
    });
    expect(mapped.delayScan).toBe(true);
    const plan = planTrackingUpdate({
      currentStatus: "IN_TRANSIT",
      currentOperational: "IN_TRANSIT",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-02T00:00:00.000Z",
      mapped,
    });
    expect(plan.whatsappEvents).toEqual(["shipment_delayed"]);
    expect(plan.applyStatus).toBe(false);
  });

  it("does not move status for an older scan", () => {
    const plan = planTrackingUpdate({
      currentStatus: "OUT_FOR_DELIVERY",
      currentOperational: "OUT_FOR_DELIVERY",
      returnStarted: false,
      lastEventAt: "2026-09-03T00:00:00.000Z",
      eventAt: "2026-09-01T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "ITEM_RETURNED", eventDescription: null }),
    });
    expect(plan.applyStatus).toBe(false);
    expect(plan.updateLastScan).toBe(false);
  });

  it("turns a later plain delivered scan into RTO delivered without marking the order delivered", () => {
    const plan = planTrackingUpdate({
      currentStatus: "RTO",
      currentOperational: "RTO",
      returnStarted: true,
      lastEventAt: "2026-09-02T00:00:00.000Z",
      eventAt: "2026-09-04T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "ITEM_DELIVERED", eventDescription: "Item Delivered" }),
    });
    expect(plan.operationalStatus).toBe("RTO_DELIVERED");
    expect(plan.shipmentStatus).toBe("RTO");
    expect(plan.orderStatus).toBeNull();
  });

  it("allows a newer return to leave consignee delivered", () => {
    const plan = planTrackingUpdate({
      currentStatus: "DELIVERED",
      currentOperational: "DELIVERED",
      returnStarted: false,
      lastEventAt: "2026-09-02T00:00:00.000Z",
      eventAt: "2026-09-05T00:00:00.000Z",
      mapped: mapIndiaPostEventToShipmentUpdate({ eventCode: "ITEM_RETURNED", eventDescription: "Item returned" }),
    });
    expect(plan.shipmentStatus).toBe("RTO");
    expect(plan.orderStatus).toBeNull();
  });
});

describe("bulkEventOccurredAt", () => {
  it("uses an ISO date field without concatenating time again", () => {
    expect(
      bulkEventOccurredAt({ date: "2026-09-07T15:24:12Z", time: "15:24:12" })
    ).toBe("2026-09-07T15:24:12.000Z");
  });

  it("combines a civil date and time when date is not ISO", () => {
    const parsed = bulkEventOccurredAt({ date: "2026-09-27", time: "10:15:00" });
    expect(parsed).toBeTruthy();
    expect(Number.isNaN(Date.parse(parsed ?? ""))).toBe(false);
  });

  it("does not invent a timestamp when date and time are missing", () => {
    expect(bulkEventOccurredAt({})).toBeNull();
  });
});

describe("tracking poll eligibility", () => {
  it("does not poll FAILED booking shipments", () => {
    expect(TRACKING_POLL_STATUSES).not.toContain("FAILED");
    expect(isTrackingPollStatus("FAILED")).toBe(false);
    expect(isTrackingPollStatus("BOOKED")).toBe(true);
  });
});

describe("matchingBulkTrackingArticle", () => {
  it("does not fall back to another article in the batch", () => {
    const match = matchingBulkTrackingArticle(
      [
        { booking_details: { article_number: "OTHERIN" } },
        { booking_details: { article_number: "AW784699994IN" } },
      ],
      "MISSINGIN"
    );
    expect(match).toBeNull();
  });

  it("uses the only unlabeled article when the requested AWB has scans", () => {
    const match = matchingBulkTrackingArticle(
      [{ tracking_details: [{ event: "Item Booked", date: "2026-10-09", time: "11:33:44" }] }],
      "CX075250656IN"
    );
    expect(match?.tracking_details?.[0]?.event).toBe("Item Booked");
  });
});

describe("applyIndiaPostTracking", () => {
  it("persists operational_status for Item Delivered(Addressee)", async () => {
    const { client, updates, events } = memorySupabase();
    const result = await applyIndiaPostTracking(client, snapshot(), {
      eventCode: "ITEM_DELIVERED",
      eventDescription: "Item Delivered(Addressee)",
      officeName: "Pandhana S.O",
      officeId: null,
      occurredAt: "2026-09-04T08:00:00.000Z",
      raw: {},
      nonDeliveryReason: null,
      mapText: "Item Delivered(Addressee)",
    });
    expect(result.operationalStatus).toBe("DELIVERED");
    expect(events[0].classification).toBe("DELIVERED");
    expect(updates.some((update) => update.patch.operational_status === "DELIVERED")).toBe(true);
  });

  it("does not increment the NDR attempt count for a duplicate event", async () => {
    const { client, updates } = memorySupabase();
    const first = await applyIndiaPostTracking(client, snapshot({ status: "OUT_FOR_DELIVERY", operationalStatus: "OUT_FOR_DELIVERY" }), {
      eventCode: "DELIVERY_ATTEMPTED",
      eventDescription: "Delivery attempted",
      officeName: "Pandhana S.O",
      officeId: "23660808",
      occurredAt: "2026-09-02T08:00:00.000Z",
      raw: { non_delivery_reason: "Door locked" },
      nonDeliveryReason: "Door locked",
    });
    expect(first.inserted).toBe(true);
    expect(first.snapshot.ndrAttemptCount).toBe(1);

    const second = await applyIndiaPostTracking(client, first.snapshot, {
      eventCode: "DELIVERY_ATTEMPTED",
      eventDescription: "Delivery attempted",
      officeName: "Pandhana S.O",
      officeId: "23660808",
      occurredAt: "2026-09-02T08:00:00.000Z",
      raw: { non_delivery_reason: "Door locked" },
      nonDeliveryReason: "Door locked",
    });
    expect(second.duplicate).toBe(true);
    expect(second.snapshot.ndrAttemptCount).toBe(1);
    const attemptPatches = updates
      .filter((update) => update.table === "shipments")
      .map((update) => update.patch.ndr_attempt_count)
      .filter((value) => value !== undefined);
    expect(attemptPatches).toEqual([1]);
  });

  it("does not write an order delivered update for a return delivery", async () => {
    const { client, updates } = memorySupabase();
    const result = await applyIndiaPostTracking(
      client,
      snapshot({ status: "RTO", operationalStatus: "RTO_IN_TRANSIT", rtoInitiatedAt: "2026-09-02T00:00:00.000Z" }),
      {
        eventCode: "ITEM_DELIVERED",
        eventDescription: "Item Delivered",
        officeName: "Origin office",
        officeId: null,
        occurredAt: "2026-09-06T00:00:00.000Z",
        raw: {},
        nonDeliveryReason: null,
      }
    );
    expect(result.operationalStatus).toBe("RTO_DELIVERED");
    expect(result.orderStatus).toBeNull();
    expect(updates.some((update) => update.table === "orders")).toBe(false);
  });

  it("stores office id and remarks and maps rts without using wall-clock delivery", async () => {
    const { client, events, updates } = memorySupabase();
    const ingested = await ingestBulkTrackingArticle(client, {
      organizationId: "org-1",
      shipment: snapshot({ status: "IN_TRANSIT", operationalStatus: "IN_TRANSIT" }),
      article: {
        booking_details: { article_number: "AW1", delivery_confirmed_on: "2026-09-08T04:00:00.000Z" },
        tracking_details: [
          {
            event: "Item Kept on Hold",
            office: "Kalanjoor SO",
            officeid: "22660021",
            date: "2026-09-07T15:24:12Z",
            time: "15:24:12",
            remarks: "Intimation Delivered",
            rts: false,
          },
          {
            event: "Item Dispatched",
            officeid: "22360017",
            date: "2026-09-08T01:00:00Z",
            time: "01:00:00",
            rts: true,
          },
        ],
        del_status: { del_status: "delivered" },
      },
    });
    expect(events[0]).toMatchObject({
      office_id: "22660021",
      event_description: "Item Kept on Hold — Intimation Delivered",
    });
    expect((events[0].raw as { _meta?: { source?: string } })._meta?.source).toBe("bulk");
    expect(ingested.snapshot.status).toBe("RTO");
    const delivery = updates.find((update) => update.patch.status === "DELIVERED");
    expect(delivery).toBeUndefined();
  });

  it("skips events without a postal timestamp instead of applying wall-clock order", async () => {
    const { client, events, updates } = memorySupabase();
    const ingested = await ingestBulkTrackingArticle(client, {
      organizationId: "org-1",
      shipment: snapshot({ status: "IN_TRANSIT", operationalStatus: "IN_TRANSIT" }),
      article: {
        tracking_details: [{ event: "Item Delivered(Addressee)", event_code: "ITEM_DELIVERED" }],
      },
    });
    expect(events).toHaveLength(0);
    expect(ingested.snapshot.operationalStatus).toBe("IN_TRANSIT");
    expect(updates.some((update) => update.patch.operational_status === "DELIVERED")).toBe(false);
  });
});

describe("processIndiaPostInboxEvent", () => {
  it("ignores an inbox event that was already processed", async () => {
    const supabase = {
      from(table: string) {
        if (table !== "provider_webhook_inbox") throw new Error(`unexpected ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "inbox-1", process_status: "PROCESSED", organization_id: "org-1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    };
    await expect(processIndiaPostInboxEvent(supabase as never, "inbox-1", "org-1")).resolves.toEqual({
      processed: false,
      reason: "already-processed",
    });
  });
});
