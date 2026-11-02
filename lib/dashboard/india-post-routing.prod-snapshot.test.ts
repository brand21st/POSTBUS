import { describe, expect, it } from "vitest";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import type { TrackingEvent } from "@/types/api";

/** Production `tracking_events` for CL556974885IN as of 2026-10-17 (last_event_at is null). */
const DELIVERED_EVENTS: TrackingEvent[] = [
  { id: "1", eventCode: "Item Booked", eventDescription: "Item Booked", officeName: "Kolenchery SO", occurredAt: "2026-09-25T12:49:11.099Z" },
  { id: "2", eventCode: "Item bagged", eventDescription: "Item bagged", officeName: "Kolenchery SO", occurredAt: "2026-09-25T16:19:00.829Z" },
  { id: "3", eventCode: "Item Dispatched", eventDescription: "Item Dispatched", officeName: "Kolenchery SO", occurredAt: "2026-09-25T16:34:25.392Z" },
  { id: "4", eventCode: "Bag Received for Forwarding", eventDescription: "Bag Received for Forwarding", officeName: "Ernakulam RMS TMO", occurredAt: "2026-09-25T19:49:31.235Z" },
  { id: "5", eventCode: "Item Dispatched", eventDescription: "Item Dispatched", officeName: "Ernakulam RMS TMO", occurredAt: "2026-09-25T19:50:19.077Z" },
  { id: "6", eventCode: "Bag Received", eventDescription: "Bag Received", officeName: "Kochi PH", occurredAt: "2026-09-25T20:29:23.850Z" },
  { id: "7", eventCode: "Item Received", eventDescription: "Item Received", officeName: "Kochi PH", occurredAt: "2026-09-25T20:39:41.993Z" },
  { id: "8", eventCode: "Item bagged", eventDescription: "Item bagged", officeName: "Kochi PH", occurredAt: "2026-09-26T04:11:38.753Z" },
  { id: "9", eventCode: "Item Dispatched", eventDescription: "Item Dispatched", officeName: "Kochi PH", occurredAt: "2026-09-26T04:45:05.775Z" },
  { id: "10", eventCode: "Bag Received", eventDescription: "Bag Received", officeName: "Palluruthy SO", occurredAt: "2026-09-26T08:40:42.613Z" },
  { id: "11", eventCode: "Item received at Destination", eventDescription: "Item received at Destination", officeName: "Palluruthy SO", occurredAt: "2026-09-26T08:42:54.769Z" },
  { id: "12", eventCode: "Taken out for delivery", eventDescription: "Taken out for delivery", officeName: "Palluruthy SO", occurredAt: "2026-09-26T10:03:47.390Z" },
  { id: "13", eventCode: "Item Delivered(Addressee)", eventDescription: "Item Delivered(Addressee)", officeName: "Palluruthy SO", occurredAt: "2026-09-26T14:16:03.000Z" },
];

describe("production Routing Steps snapshots", () => {
  it("renders a full delivered India Post journey when last_event_at is missing", () => {
    const view = buildIndiaPostRoutingView(
      {
        barcode: "CL556974885IN",
        trackingNumber: "CL556974885IN",
        status: "DELIVERED",
        operationalStatus: null,
        lastEventAt: null,
        lastEventDescription: null,
      },
      DELIVERED_EVENTS
    );

    expect(view.steps).toHaveLength(13);
    expect(view.steps[0]?.title).toBe("Item Booked");
    expect(view.steps.at(-1)).toMatchObject({
      title: "Item Delivered(Addressee)",
      office: "Palluruthy SO",
      latest: true,
    });
    expect(view.steps.every((step) => step.dateLabel !== "—")).toBe(true);
    expect(view.currentEvent).toBe("Item Delivered(Addressee)");
    expect(view.progressPercent).toBe(100);
    expect(view.stages.find((stage) => stage.stage === "DELIVERED")?.completed).toBe(true);
    expect(view.stages.find((stage) => stage.stage === "OUT_FOR_DELIVERY")?.completed).toBe(true);
  });

  it("keeps Routing Steps empty for a booked article with no scans", () => {
    const view = buildIndiaPostRoutingView(
      {
        barcode: "CX075364295IN",
        trackingNumber: "CX075364295IN",
        status: "MANIFEST_READY",
        operationalStatus: null,
        bookedAt: "2026-10-16T00:00:00.000Z",
        lastEventAt: null,
      },
      []
    );
    expect(view.steps).toEqual([]);
    expect(view.stages[0]).toMatchObject({ stage: "BOOKED", current: true, completed: false });
  });
});
