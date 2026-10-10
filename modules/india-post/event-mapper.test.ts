import { describe, expect, it } from "vitest";
import {
  mapIndiaPostEventToShipmentUpdate,
  planTrackingUpdate,
  projectShipmentFromEvents,
  type ShipmentProjection,
} from "@/modules/india-post/event-mapper";

function map(event: Parameters<typeof mapIndiaPostEventToShipmentUpdate>[0]) {
  return mapIndiaPostEventToShipmentUpdate(event);
}

function emptyProjection(overrides: Partial<ShipmentProjection> = {}): ShipmentProjection {
  return {
    status: "IN_TRANSIT",
    operationalStatus: "IN_TRANSIT",
    lastEventAt: null,
    ndrAttemptCount: 0,
    rtoInitiatedAt: null,
    ndrReason: null,
    rtoReason: null,
    deliveredAt: null,
    ambiguous: false,
    ...overrides,
  };
}

describe("CEPT event mapping matrix", () => {
  it("TEST A: Item Delivered(Addressee) is customer DELIVERED, not NDR", () => {
    const mapped = map({ eventCode: "ITEM_DELIVERED", eventDescription: "Item Delivered(Addressee)" });
    expect(mapped.operationalStatus).toBe("DELIVERED");
    expect(mapped.shipmentStatus).toBe("DELIVERED");
    expect(mapped.classification).toBe("DELIVERED");
  });

  it("TEST B: Item Kept on Hold plus Intimation Delivered is not NDR", () => {
    expect(
      map({ eventCode: "ITEM_HOLD", eventDescription: "Item Kept on Hold — Intimation Delivered" }).classification
    ).toBeNull();
    expect(map({ eventCode: "EVENT", eventDescription: "Intimation Delivered" }).classification).toBeNull();
  });

  it("TEST C: explicit non-delivery reason still classifies as NDR", () => {
    const mapped = map({
      eventCode: "ITEM_DELIVERY",
      eventDescription: "Delivery attempted",
      nonDeliveryReason: "Addressee cannot be located",
    });
    expect(mapped.operationalStatus).toBe("NDR");
    expect(mapped.ndrReason).toBe("Addressee cannot be located");
  });

  it("maps unknown ambiguous events without inventing a terminal state", () => {
    expect(map({ eventCode: "CEPT_NEW_SCAN", eventDescription: "Customs hold" }).classification).toBeNull();
    expect(map({ eventCode: "EVENT", eventDescription: "Item Redirected" }).classification).toBeNull();
  });

  it("maps dispatch, bagged, bag received, and out for delivery as movement", () => {
    expect(map({ eventCode: "EVENT", eventDescription: "Item Dispatched" }).operationalStatus).toBe("DISPATCHED");
    expect(map({ eventCode: "EVENT", eventDescription: "Item bagged" }).operationalStatus).toBe("DISPATCHED");
    expect(map({ eventCode: "EVENT", eventDescription: "Bag Received" }).operationalStatus).toBe("IN_TRANSIT");
    expect(map({ eventCode: "EVENT", eventDescription: "Taken out for delivery" }).operationalStatus).toBe(
      "OUT_FOR_DELIVERY"
    );
  });

  it("maps rts true/false/missing without assuming missing means false RTO", () => {
    expect(map({ eventCode: "EVENT", eventDescription: "Item Dispatched", rts: true }).operationalStatus).toBe("RTO");
    expect(map({ eventCode: "EVENT", eventDescription: "Item Dispatched", rts: false }).operationalStatus).toBe(
      "DISPATCHED"
    );
    expect(map({ eventCode: "EVENT", eventDescription: "Item Dispatched" }).operationalStatus).toBe("DISPATCHED");
  });

  it("maps return in transit and return delivered separately from customer delivery", () => {
    expect(map({ eventCode: "EVENT", eventDescription: "Return in transit" }).operationalStatus).toBe("RTO_IN_TRANSIT");
    expect(map({ eventCode: "EVENT", eventDescription: "Delivered to sender" }).operationalStatus).toBe("RTO_DELIVERED");
    expect(map({ eventCode: "ITEM_DELIVERED", eventDescription: "Item Delivered(Addressee)" }).operationalStatus).toBe(
      "DELIVERED"
    );
  });
});

describe("planTrackingUpdate return vs customer delivery", () => {
  it("TEST D/E: rts/return context does not become customer DELIVERED", () => {
    const plan = planTrackingUpdate({
      currentStatus: "RTO",
      currentOperational: "RTO",
      returnStarted: true,
      lastEventAt: "2026-09-02T00:00:00.000Z",
      eventAt: "2026-09-04T00:00:00.000Z",
      mapped: map({ eventCode: "ITEM_DELIVERED", eventDescription: "Item Delivered(Addressee)" }),
    });
    expect(plan.operationalStatus).toBe("RTO_DELIVERED");
    expect(plan.orderStatus).toBeNull();
    expect(plan.whatsappEvents).not.toContain("delivered");
  });

  it("TEST F: older NDR then confirmed customer delivery resolves to DELIVERED", () => {
    const after = projectShipmentFromEvents(
      [
        {
          eventCode: "DELIVERY_ATTEMPTED",
          eventDescription: "Delivery attempted",
          nonDeliveryReason: "Door locked",
          occurredAt: "2026-09-02T08:00:00.000Z",
        },
        {
          eventCode: "ITEM_DELIVERED",
          eventDescription: "Item Delivered(Addressee)",
          occurredAt: "2026-09-03T08:00:00.000Z",
        },
      ],
      emptyProjection()
    );
    expect(after.operationalStatus).toBe("DELIVERED");
    expect(after.ndrAttemptCount).toBe(1);
    expect(after.deliveredAt).toBe("2026-09-03T08:00:00.000Z");
  });

  it("TEST G: duplicate events do not change classification or attempt count", () => {
    const events = [
      {
        eventCode: "DELIVERY_ATTEMPTED",
        eventDescription: "Delivery attempted",
        nonDeliveryReason: "Door locked",
        occurredAt: "2026-09-02T08:00:00.000Z",
      },
      {
        eventCode: "DELIVERY_ATTEMPTED",
        eventDescription: "Delivery attempted",
        nonDeliveryReason: "Door locked",
        occurredAt: "2026-09-02T08:00:00.000Z",
      },
    ];
    const after = projectShipmentFromEvents(events, emptyProjection());
    expect(after.operationalStatus).toBe("NDR");
    expect(after.ndrAttemptCount).toBe(1);
  });

  it("does not let an older event regress a newer status", () => {
    const plan = planTrackingUpdate({
      currentStatus: "DELIVERED",
      currentOperational: "DELIVERED",
      returnStarted: false,
      lastEventAt: "2026-09-03T00:00:00.000Z",
      eventAt: "2026-09-01T00:00:00.000Z",
      mapped: map({ eventCode: "DELIVERY_ATTEMPTED", eventDescription: "Delivery attempted" }),
    });
    expect(plan.applyStatus).toBe(false);
  });

  it("NDR followed by return initiation becomes RTO", () => {
    const after = projectShipmentFromEvents(
      [
        {
          eventCode: "DELIVERY_ATTEMPTED",
          eventDescription: "Delivery attempted",
          nonDeliveryReason: "Refused",
          occurredAt: "2026-09-02T08:00:00.000Z",
        },
        {
          eventCode: "ITEM_RETURNED",
          eventDescription: "Item returned",
          occurredAt: "2026-09-03T08:00:00.000Z",
        },
      ],
      emptyProjection()
    );
    expect(after.operationalStatus).toBe("RTO");
    expect(after.status).toBe("RTO");
    expect(after.ndrAttemptCount).toBe(1);
  });

  it("does not queue WhatsApp for NDR or RTO classifications", () => {
    const ndr = planTrackingUpdate({
      currentStatus: "OUT_FOR_DELIVERY",
      currentOperational: "OUT_FOR_DELIVERY",
      returnStarted: false,
      lastEventAt: "2026-09-01T00:00:00.000Z",
      eventAt: "2026-09-02T00:00:00.000Z",
      mapped: map({
        eventCode: "DELIVERY_ATTEMPTED",
        eventDescription: "Delivery attempted",
        nonDeliveryReason: "Door locked",
      }),
    });
    expect(ndr.operationalStatus).toBe("NDR");
    expect(ndr.whatsappEvents).toEqual([]);
    expect(ndr.orderStatus).toBeNull();

    const rto = planTrackingUpdate({
      currentStatus: "NDR",
      currentOperational: "NDR",
      returnStarted: false,
      lastEventAt: "2026-09-02T00:00:00.000Z",
      eventAt: "2026-09-03T00:00:00.000Z",
      mapped: map({ eventCode: "ITEM_RETURNED", eventDescription: "Item returned" }),
    });
    expect(rto.operationalStatus).toBe("RTO");
    expect(rto.whatsappEvents).toEqual([]);
  });
});
