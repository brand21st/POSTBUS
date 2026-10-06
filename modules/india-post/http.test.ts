import { describe, expect, it } from "vitest";
import { INDIA_POST_TIMEOUT_MS, inlineLabelTimeoutMs, shouldWaitForQueuedBookings } from "@/modules/india-post/http";
import { chunkIds, indiaPostBookingConcurrency } from "@/modules/india-post/booking-batch";
import { INDIA_POST_TRACKING_BULK_LIMIT } from "@/modules/india-post/spec";

describe("India Post booking limits", () => {
  it("keeps booking concurrency bounded", () => {
    expect(indiaPostBookingConcurrency()).toBeGreaterThanOrEqual(1);
    expect(indiaPostBookingConcurrency()).toBeLessThanOrEqual(20);
  });

  it("sets finite CEPT timeouts", () => {
    expect(INDIA_POST_TIMEOUT_MS.book).toBe(10_000);
    expect(INDIA_POST_TIMEOUT_MS.label).toBe(20_000);
  });

  it("never puts more than 500 barcodes in one tracking request", () => {
    const barcodes = Array.from({ length: 501 }, (_, index) => `ET${String(index).padStart(9, "0")}IN`);
    const batches = chunkIds(barcodes, INDIA_POST_TRACKING_BULK_LIMIT);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(1);
  });
});

describe("20s book+label budget", () => {
  it("uses leftover time for the label and queues instead of failing the booking", () => {
    expect(inlineLabelTimeoutMs(0, 0)).toBe(20_000);
    expect(inlineLabelTimeoutMs(0, 12_000)).toBe(8_000);
    expect(inlineLabelTimeoutMs(0, 18_000)).toBe(0);
  });

  it("waits in the click for up to 4 bookings, not a large bulk", () => {
    expect(shouldWaitForQueuedBookings(1)).toBe(true);
    expect(shouldWaitForQueuedBookings(4)).toBe(true);
    expect(shouldWaitForQueuedBookings(5)).toBe(false);
  });
});
