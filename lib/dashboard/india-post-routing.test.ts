import { describe, expect, it } from "vitest";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import type { TrackingEvent } from "@/types/api";

function event(partial: Partial<TrackingEvent> & { eventDescription: string; occurredAt: string }): TrackingEvent {
  return {
    eventCode: "EVENT",
    officeName: "Pulikkal SO",
    ...partial,
  };
}

describe("buildIndiaPostRoutingView", () => {
  it("orders routing steps oldest-first and marks the latest scan current", () => {
    const view = buildIndiaPostRoutingView(
      {
        barcode: "CX075250656IN",
        serviceCode: "BUSINESS_PARCEL",
        bookedAt: "2026-10-09T06:03:44.000Z",
        originCity: "Pulikkal SO",
        shippingCity: "Eravipuram SO",
        shippingPincode: "691011",
        operationalStatus: "IN_TRANSIT",
        status: "IN_TRANSIT",
      },
      [
        event({
          id: "later",
          eventDescription: "Item Dispatched",
          officeName: "Kozhikode PH",
          occurredAt: "2026-10-09T23:14:05.000Z",
        }),
        event({
          id: "first",
          eventDescription: "Item Booked",
          occurredAt: "2026-10-09T06:03:44.000Z",
        }),
      ]
    );

    expect(view.articleNumber).toBe("CX075250656IN");
    expect(view.articleType).toBe("BUSINESS_PARCEL");
    expect(view.steps.map((step) => step.title)).toEqual(["Item Booked", "Item Dispatched"]);
    expect(view.steps[0]?.latest).toBe(false);
    expect(view.steps[1]?.latest).toBe(true);
    expect(view.currentEvent).toBe("Item Dispatched");
    expect(view.destinationPincode).toBe("691011");
    const inTransit = view.stages.find((stage) => stage.stage === "IN_TRANSIT");
    const booked = view.stages.find((stage) => stage.stage === "BOOKED");
    const dispatched = view.stages.find((stage) => stage.stage === "DISPATCHED");
    expect(booked?.completed).toBe(true);
    expect(dispatched?.completed).toBe(true);
    expect(inTransit?.current).toBe(true);
    expect(view.stages.find((stage) => stage.stage === "OUT_FOR_DELIVERY")).toMatchObject({
      completed: false,
      current: false,
    });
    expect(view.stages.find((stage) => stage.stage === "DELIVERED")?.completed).toBe(false);
    expect(view.progressPercent).toBe(50);
  });

  it("keeps booked as the current stage when there are no scans", () => {
    const view = buildIndiaPostRoutingView(
      {
        barcode: "CL214330016IN",
        status: "MANIFEST_READY",
        bookedAt: "2026-10-09T06:03:44.000Z",
      },
      []
    );
    expect(view.steps).toEqual([]);
    expect(view.stages[0]).toMatchObject({ stage: "BOOKED", current: true, completed: false });
    expect(view.stages.slice(1).every((stage) => !stage.completed && !stage.current)).toBe(true);
    expect(view.progressPercent).toBe(0);
  });

  it("advances past booked using tracking events even when shipment status is still booked", () => {
    const view = buildIndiaPostRoutingView(
      {
        barcode: "CX075250656IN",
        status: "BOOKED",
        operationalStatus: "BOOKED",
        bookedAt: "2026-10-09T06:03:44.000Z",
      },
      [
        event({
          eventDescription: "Item Dispatched",
          occurredAt: "2026-10-09T23:14:05.000Z",
        }),
      ]
    );
    expect(view.stages.find((stage) => stage.stage === "DISPATCHED")).toMatchObject({
      current: true,
      completed: false,
    });
    expect(view.stages.find((stage) => stage.stage === "BOOKED")?.completed).toBe(true);
  });

  it("uses the last India Post scan when the events list is empty", () => {
    const view = buildIndiaPostRoutingView(
      {
        barcode: "CX075250656IN",
        status: "MANIFEST_READY",
        lastEventDescription: "Bag Received",
        lastScanOffice: "Kozhikode PH",
        lastEventAt: "2026-10-10T01:40:00.000Z",
      },
      []
    );
    expect(view.currentEvent).toBe("Bag Received");
    expect(view.steps[0]).toMatchObject({ title: "Bag Received", office: "Kozhikode PH", latest: true });
    expect(view.stages.find((stage) => stage.stage === "IN_TRANSIT")?.current).toBe(true);
    expect(view.stages.find((stage) => stage.stage === "BOOKED")?.completed).toBe(true);
    expect(view.stages.find((stage) => stage.stage === "DISPATCHED")?.completed).toBe(true);
  });
});

