import { describe, expect, it } from "vitest";
import { classifyCustomerEvent, toCustomerTrackView } from "./customer-track-view";
import type { PublicTrackResult } from "@/types/api";

function result(overrides: Partial<NonNullable<PublicTrackResult["shipment"]>> = {}): PublicTrackResult {
  return {
    found: true,
    liveTracking: "ok",
    shipment: {
      id: "ship-1",
      barcode: "EM123456789IN",
      trackingNumber: "EM123456789IN",
      status: "IN_TRANSIT",
      operationalStatus: "IN_TRANSIT",
      serviceLabel: "Speed Post parcel",
      originCity: "Wayanad",
      originState: "Kerala",
      destinationCity: "Bangalore",
      destinationState: "Karnataka",
      bookedAt: "2026-10-01T09:40:00.000Z",
      lastUpdatedAt: "2026-10-02T05:12:00.000Z",
      weightGrams: 500,
      paymentMode: "Prepaid",
      codAmount: null,
      events: [
        {
          id: "e4",
          eventCode: "ITEM_RECEIVED",
          eventDescription: "Item Received",
          officeName: "Kozhikode RMS",
          occurredAt: "2026-10-02T05:12:00.000Z",
        },
        {
          id: "e3",
          eventCode: "BAG_CLOSE",
          eventDescription: "Bag Close",
          officeName: "Wayanad HO",
          occurredAt: "2026-10-01T18:20:00.000Z",
        },
        {
          id: "e1",
          eventCode: "ITEM_BOOKED",
          eventDescription: "Item Booked",
          officeName: "Wayanad",
          occurredAt: "2026-10-01T09:40:00.000Z",
        },
      ],
      ...overrides,
    },
  };
}

describe("classifyCustomerEvent", () => {
  it("maps known India Post events onto progress stages", () => {
    expect(classifyCustomerEvent({ eventCode: "BAG_CLOSE", eventDescription: "Bag Close" })).toEqual({
      stage: "DISPATCHED",
      status: "DISPATCHED",
    });
    expect(classifyCustomerEvent({ eventCode: "OFD", eventDescription: "Out for delivery" }).stage).toBe(
      "OUT_FOR_DELIVERY"
    );
    expect(classifyCustomerEvent({ eventCode: "ITEM_DELIVERED", eventDescription: "Item Delivered" }).stage).toBe(
      "DELIVERED"
    );
  });

  it("keeps unknown codes renderable", () => {
    expect(classifyCustomerEvent({ eventCode: "CEPT_NEW_SCAN", eventDescription: "Customs hold" })).toEqual({
      stage: null,
      status: "CEPT_NEW_SCAN",
    });
  });
});

describe("toCustomerTrackView", () => {
  it("builds a customer view without inventing ETA or skipped stages", () => {
    const view = toCustomerTrackView(result());
    expect(view?.expectedDeliveryAt).toBeNull();
    expect(view?.progress.map((step) => step.stage)).toEqual([
      "BOOKED",
      "DISPATCHED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(view?.progress.find((step) => step.stage === "ACCEPTED")).toBeUndefined();
    expect(view?.events[0]?.latest).toBe(true);
    expect(view?.nextStepLabel).toBe("Out for Delivery");
    expect(view?.details.some((row) => row.label === "COD Amount")).toBe(false);
  });

  it("shows COD amount only for COD shipments", () => {
    const view = toCustomerTrackView(
      result({
        paymentMode: "COD",
        codAmount: 1500,
      })
    );
    expect(view?.details).toEqual(
      expect.arrayContaining([
        { label: "Payment", value: "COD" },
        { label: "COD Amount", value: "₹1,500.00" },
      ])
    );
  });

  it("renders unknown timeline titles in a human-friendly form", () => {
    const view = toCustomerTrackView(
      result({
        events: [
          {
            eventCode: "X_UNKNOWN",
            eventDescription: "Held at customs desk",
            officeName: "DEL HO",
            occurredAt: "2026-10-02T05:12:00.000Z",
          },
        ],
      })
    );
    expect(view?.events[0]?.title).toBe("Held At Customs Desk");
    expect(view?.events[0]?.status).toBe("X_UNKNOWN");
  });

  it("surfaces a calm exception card for NDR without extra progress stages", () => {
    const view = toCustomerTrackView(
      result({
        status: "NDR",
        operationalStatus: "NDR",
        events: [
          {
            eventCode: "NON_DELIVERY",
            eventDescription: "Delivery attempted",
            officeName: "Sulthan Bathery H.O",
            occurredAt: "2026-10-02T05:12:00.000Z",
          },
          {
            eventCode: "ITEM_BOOKED",
            eventDescription: "Item Booked",
            officeName: "Wayanad",
            occurredAt: "2026-10-01T09:40:00.000Z",
          },
        ],
      })
    );
    expect(view?.exception?.latestTitle).toBe("Delivery Attempted");
    expect(view?.progress.some((step) => step.stage === "DELIVERED")).toBe(true);
    expect(view?.statusTone).toBe("error");
  });

  it("returns null when no shipment was found", () => {
    expect(toCustomerTrackView({ found: false, liveTracking: "unavailable", shipment: null })).toBeNull();
  });
});
