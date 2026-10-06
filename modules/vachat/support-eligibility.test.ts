import { describe, expect, it } from "vitest";
import {
  currentShipmentDeliveredAt,
  isWhatsAppSupportEligible,
  WHATSAPP_SUPPORT_WINDOW_MS,
} from "@/modules/vachat/support-eligibility";

const DELIVERED_AT = new Date("2026-01-01T10:00:00.000Z");

function atOffset(days: number, extraMs = 0) {
  return new Date(DELIVERED_AT.getTime() + days * 86_400_000 + extraMs);
}

describe("isWhatsAppSupportEligible", () => {
  it("treats missing delivery timestamps as eligible", () => {
    const now = atOffset(40);
    expect(isWhatsAppSupportEligible({ deliveredAt: null, now })).toBe(true);
    expect(isWhatsAppSupportEligible({ deliveredAt: undefined, now })).toBe(true);
    expect(isWhatsAppSupportEligible({ deliveredAt: "", now })).toBe(true);
  });

  it("is eligible immediately after delivery", () => {
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT, now: DELIVERED_AT })).toBe(true);
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT.toISOString(), now: atOffset(0, 1) })).toBe(true);
  });

  it("is eligible 1 and 19 days later", () => {
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT, now: atOffset(1) })).toBe(true);
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT, now: atOffset(19) })).toBe(true);
  });

  it("is eligible at the exact 20 calendar-day instant", () => {
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT, now: atOffset(20) })).toBe(true);
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT.toISOString(), now: new Date(DELIVERED_AT.getTime() + WHATSAPP_SUPPORT_WINDOW_MS) })).toBe(true);
  });

  it("is ineligible just after the 20-day boundary and at 21 days", () => {
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT, now: atOffset(20, 1) })).toBe(false);
    expect(isWhatsAppSupportEligible({ deliveredAt: DELIVERED_AT, now: atOffset(21) })).toBe(false);
  });

  it("fails closed for unparseable and future delivered_at", () => {
    const now = new Date("2026-01-05T10:00:00.000Z");
    expect(isWhatsAppSupportEligible({ deliveredAt: "not-a-date", now })).toBe(false);
    expect(isWhatsAppSupportEligible({ deliveredAt: "2026-01-06T10:00:00.000Z", now })).toBe(false);
  });

  it("does not depend on the process timezone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(isWhatsAppSupportEligible({ deliveredAt: "2026-01-01T10:00:00.000Z", now: new Date("2026-01-21T10:00:00.000Z") })).toBe(true);
      expect(isWhatsAppSupportEligible({ deliveredAt: "2026-01-01T10:00:00.000Z", now: new Date("2026-01-21T10:00:00.001Z") })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("currentShipmentDeliveredAt", () => {
  it("uses the latest updated_at shipment for the order", () => {
    const deliveredAt = currentShipmentDeliveredAt(
      [
        { order_id: "ord-a", delivered_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z" },
        { order_id: "ord-a", delivered_at: "2026-01-10T00:00:00.000Z", updated_at: "2026-01-11T00:00:00.000Z" },
        { order_id: "ord-b", delivered_at: "2025-01-01T00:00:00.000Z", updated_at: "2026-12-01T00:00:00.000Z" },
      ],
      "ord-a"
    );
    expect(deliveredAt).toBe("2026-01-10T00:00:00.000Z");
  });
});
