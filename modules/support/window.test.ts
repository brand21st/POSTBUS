import { describe, expect, it } from "vitest";
import {
  isServiceWindowOpen,
  serviceWindowExpiresAt,
  shouldAdvanceCustomerTimestamp,
} from "@/modules/support/window";

describe("customer service window", () => {
  it("expires 24 hours after the customer message", () => {
    const start = new Date("2026-10-09T10:00:00.000Z");
    const expires = serviceWindowExpiresAt(start)!;
    expect(expires.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(isServiceWindowOpen(expires, new Date("2026-10-10T09:59:00.000Z"))).toBe(true);
    expect(isServiceWindowOpen(expires, new Date("2026-10-10T10:01:00.000Z"))).toBe(false);
  });

  it("does not rewind the window for an older inbound event", () => {
    expect(shouldAdvanceCustomerTimestamp("2026-10-09T12:00:00.000Z", "2026-10-09T11:00:00.000Z")).toBe(false);
    expect(shouldAdvanceCustomerTimestamp("2026-10-09T12:00:00.000Z", "2026-10-09T12:05:00.000Z")).toBe(true);
  });
});
