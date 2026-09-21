import { describe, expect, it } from "vitest";
import { canAdvanceShipmentStatus, mapIndiaPostEventToShipmentUpdate } from "./event-mapper";
import {
  CEPT_SAMPLE_WEBHOOK_PAYLOAD,
  maskTrackingNumber,
  parseIndiaPostWebhook,
  safeWebhookHeaders,
} from "./webhook-parser";
import { indiaPostWebhookIdempotencyKey } from "./webhook";
import { indiaPostWebhookUrls, parseIndiaPostWebhookPath } from "./webhook-urls";

describe("CEPT webhook parser", () => {
  it("parses the official CEPT sample payload", () => {
    const parsed = parseIndiaPostWebhook(
      JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
      "application/json",
      "events"
    );
    expect(parsed.parseError).toBeNull();
    expect(parsed.barcode).toBe("AW784699994IN");
    expect(parsed.eventCode).toBe("BAG_CLOSE");
    expect(parsed.eventDescription).toBe("Bag Close");
    expect(parsed.officeId).toBe("21250003");
    expect(parsed.officeName).toBe("KADUGODI BNPL CENTRE");
    expect(parsed.customerId).toBe("1000002954");
    expect(parsed.contractId).toBe("40000354");
    expect(parsed.providerEventId).toBeNull();
    expect(parsed.eventTimestamp).toBe("2025-11-09T08:37:52.000Z");
  });

  it("rejects malformed JSON", () => {
    const parsed = parseIndiaPostWebhook("{not-json", "application/json", "booking");
    expect(parsed.parseError).toBe("Body is not JSON.");
    expect(parsed.barcode).toBeNull();
  });

  it("does not invent XML support", () => {
    const parsed = parseIndiaPostWebhook("<event/>", "application/xml", "events");
    expect(parsed.parseError).toMatch(/XML/);
  });

  it("records missing barcode without inventing one", () => {
    const parsed = parseIndiaPostWebhook(
      JSON.stringify({ event_code: "BAG_CLOSE", event_date: "2025-11-09", event_time: "08:37:52" }),
      "application/json",
      "events"
    );
    expect(parsed.barcode).toBeNull();
    expect(parsed.eventCode).toBe("BAG_CLOSE");
  });

  it("treats unknown event codes as unparsed extras only", () => {
    const parsed = parseIndiaPostWebhook(
      JSON.stringify({
        article_number: "AW784699994IN",
        event_code: "NOT_IN_CEPT_SAMPLE",
        event_date: "2025-11-09",
        event_time: "08:37:52",
      }),
      "application/json",
      "booking"
    );
    expect(parsed.eventCode).toBe("NOT_IN_CEPT_SAMPLE");
    expect(mapIndiaPostEventToShipmentUpdate(parsed).shouldUpdateStatus).toBe(false);
  });
});

describe("event mapper", () => {
  it("maps BAG_CLOSE to in transit", () => {
    const mapped = mapIndiaPostEventToShipmentUpdate({
      eventCode: "BAG_CLOSE",
      eventDescription: "Bag Close",
    });
    expect(mapped.shouldUpdateStatus).toBe(true);
    expect(mapped.shipmentStatus).toBe("IN_TRANSIT");
  });

  it("maps delivered codes and descriptions", () => {
    expect(mapIndiaPostEventToShipmentUpdate({ eventCode: "ITEM_DELIVERED", eventDescription: null })).toEqual(
      expect.objectContaining({ shouldUpdateStatus: true, shipmentStatus: "DELIVERED" })
    );
    expect(
      mapIndiaPostEventToShipmentUpdate({ eventCode: "EVENT", eventDescription: "Item Delivered" }).shipmentStatus
    ).toBe("DELIVERED");
  });

  it("does not map booked or hold events to a new status", () => {
    for (const eventCode of ["ITEM_BOOKED", "Item Booked", "ITEM_RETURNED", "ITEM_HOLD"]) {
      expect(mapIndiaPostEventToShipmentUpdate({ eventCode, eventDescription: null }).shouldUpdateStatus).toBe(
        false
      );
    }
  });

  it("prevents delivered shipments from being downgraded", () => {
    expect(canAdvanceShipmentStatus("DELIVERED", "BOOKED")).toBe(false);
    expect(canAdvanceShipmentStatus("DELIVERED", "IN_TRANSIT")).toBe(false);
    expect(canAdvanceShipmentStatus("BOOKED", "DELIVERED")).toBe(true);
  });
});

describe("idempotency", () => {
  it("uses barcode + event_code + timestamp from the CEPT sample", () => {
    const parsed = parseIndiaPostWebhook(
      JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD),
      "application/json",
      "events"
    );
    const key = indiaPostWebhookIdempotencyKey(parsed, JSON.stringify(CEPT_SAMPLE_WEBHOOK_PAYLOAD));
    expect(key.kind).toBe("event");
    expect(key.key).toBe("AW784699994IN:BAG_CLOSE:2025-11-09T08:37:52.000Z");
  });

  it("falls back to payload hash when event identity fields are missing", () => {
    const body = JSON.stringify({ article_type: "SP_INLAND_PARCEL" });
    const parsed = parseIndiaPostWebhook(body, "application/json", "booking");
    const key = indiaPostWebhookIdempotencyKey(parsed, body);
    expect(key.kind).toBe("hash");
    expect(key.key).toHaveLength(64);
  });
});

describe("webhook URLs and tenant path", () => {
  it("builds connection-scoped booking and events URLs", () => {
    const urls = indiaPostWebhookUrls("11111111-1111-4111-8111-111111111111");
    expect(urls.bookingWebhookUrl).toMatch(
      /\/api\/v1\/webhooks\/india-post\/11111111-1111-4111-8111-111111111111\/booking$/
    );
    expect(urls.eventsWebhookUrl).toMatch(
      /\/api\/v1\/webhooks\/india-post\/11111111-1111-4111-8111-111111111111\/events$/
    );
  });

  it("parses only valid connection-scoped paths", () => {
    expect(
      parseIndiaPostWebhookPath("webhooks/india-post/11111111-1111-4111-8111-111111111111/booking")
    ).toEqual({
      connectionId: "11111111-1111-4111-8111-111111111111",
      channel: "booking",
    });
    expect(parseIndiaPostWebhookPath("webhooks/shopify")).toBeNull();
    expect(parseIndiaPostWebhookPath("webhooks/india-post/not-a-uuid/booking")).toBeNull();
  });
});

describe("security helpers", () => {
  it("masks tracking numbers and strips secret headers", () => {
    expect(maskTrackingNumber("AW784699994IN")).toBe("AW••••IN");
    const headers = new Headers({
      authorization: "Bearer secret-token",
      cookie: "a=1",
      "content-type": "application/json",
      "x-webhook-secret": "nope",
    });
    expect(safeWebhookHeaders(headers)).toEqual({ "content-type": "application/json" });
  });
});
