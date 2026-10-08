import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BILLING_ANNOUNCEMENT_COPY,
  BILLING_ANNOUNCEMENT_CTA_HREF,
  BILLING_START_IST_DATE,
  billingAnnouncementPhase,
  formatAnnouncementPlans,
  istCalendarDate,
} from "@/lib/dashboard/billing-announcement";

const helperSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "billing-announcement.ts"),
  "utf8"
);

describe("billing announcement IST calendar", () => {
  it("keeps October 31 as the last free day in Asia/Kolkata", () => {
    expect(istCalendarDate(new Date("2026-10-31T23:59:59.999+05:30"))).toBe("2026-10-31");
    expect(billingAnnouncementPhase(new Date("2026-10-31T23:59:59.999+05:30"))).toBe("free");
    expect(billingAnnouncementPhase(new Date("2026-10-31T18:29:59.999Z"))).toBe("free");
  });

  it("switches at November 1 00:00 Asia/Kolkata", () => {
    expect(BILLING_START_IST_DATE).toBe("2026-11-01");
    expect(istCalendarDate(new Date("2026-11-01T00:00:00.000+05:30"))).toBe("2026-11-01");
    expect(billingAnnouncementPhase(new Date("2026-11-01T00:00:00.000+05:30"))).toBe("billing");
    expect(billingAnnouncementPhase(new Date("2026-10-31T18:30:00.000Z"))).toBe("billing");
  });

  it("does not use UTC calendar dates around the boundary", () => {
    expect(istCalendarDate(new Date("2026-10-31T20:00:00.000Z"))).toBe("2026-11-01");
    expect(billingAnnouncementPhase(new Date("2026-10-31T20:00:00.000Z"))).toBe("billing");
  });
});

describe("billing announcement copy", () => {
  it("describes full PostBus features before billing starts, not a single plan", () => {
    expect(billingAnnouncementPhase(new Date("2026-10-31T12:00:00+05:30"))).toBe("free");
    expect(BILLING_ANNOUNCEMENT_COPY.free.message).toContain("full PostBus features");
    expect(BILLING_ANNOUNCEMENT_COPY.free.message.toLowerCase()).not.toContain("business plan");
    expect(BILLING_ANNOUNCEMENT_CTA_HREF).toBe("/dashboard/billing");
  });

  it("asks merchants to choose a plan after billing starts", () => {
    expect(BILLING_ANNOUNCEMENT_COPY.billing.message).toContain("billing starts today");
    expect(BILLING_ANNOUNCEMENT_COPY.billing.message.toLowerCase()).not.toContain("subscription is now active");
  });

  it("does not hardcode rupee amounts in the helper", () => {
    expect(helperSource).not.toMatch(/499|1499|3500|5500/);
  });
});

describe("formatAnnouncementPlans", () => {
  it("formats live monthly prices without inventing catalog amounts", () => {
    expect(
      formatAnnouncementPlans([
        { name: "Starter", monthlyPricePaise: 49900 },
        { name: " Pro ", monthlyPricePaise: 149900 },
      ]).map((plan) => plan.line)
    ).toEqual(["Starter — ₹499.00/month", "Pro — ₹1,499.00/month"]);
  });
});
